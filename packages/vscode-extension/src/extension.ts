import { spawn } from 'child_process';

import * as vscode from 'vscode';

import { analyzeCode, explainIssue, repairIssue, type AiProvider, type AnalysisIssue } from './ai-client.js';
import { McpClient } from './mcp-client.js';
import { openSetupWebview } from './setup-webview.js';

interface Finding {
  file: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  severity?: 'error' | 'warning' | 'info';
  id?: string;
}

/** The normalized shape both the MCP path and the standalone BYOK path are converted to before
 *  reaching diagnostics/CodeLens — the two source shapes (`Finding`, `AnalysisIssue`) name the
 *  same concepts differently (`column` vs nothing, `id` vs nothing), so nothing downstream should
 *  have to know which path produced a given finding. */
interface FixoraFinding {
  line: number;
  message: string;
  col?: number;
  severity?: 'error' | 'warning' | 'info';
  rule?: string;
  /** Only ever set by the standalone path — the AI-suggested replacement for the quick fix. */
  fix?: string;
}

function fromMcpFindings(findings: readonly Finding[]): FixoraFinding[] {
  return findings.map((f) => ({
    line: f.line,
    message: f.message,
    ...(f.column !== undefined ? { col: f.column } : {}),
    ...(f.severity !== undefined ? { severity: f.severity } : {}),
    ...(f.id !== undefined ? { rule: f.id } : {}),
  }));
}

function fromAnalysisIssues(issues: readonly AnalysisIssue[]): FixoraFinding[] {
  return issues.map((i) => ({
    line: i.line,
    message: i.message,
    severity: i.severity,
    ...(i.fix !== undefined ? { fix: i.fix } : {}),
  }));
}

/** CodeLens command arguments arrive as `unknown` — this is the boundary that turns one back into
 *  a `FixoraFinding`, or refuses it, rather than trusting the shape. */
function asFixoraFinding(value: unknown): FixoraFinding | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const line = v['line'];
  const message = v['message'];
  if (typeof line !== 'number' || typeof message !== 'string') return undefined;
  const severityRaw = v['severity'];
  const severity =
    severityRaw === 'error' || severityRaw === 'warning' || severityRaw === 'info' ? severityRaw : undefined;
  const ruleRaw = v['rule'];
  const rule = typeof ruleRaw === 'string' ? ruleRaw : undefined;
  const colRaw = v['col'];
  const col = typeof colRaw === 'number' ? colRaw : undefined;
  return {
    line,
    message,
    ...(severity !== undefined ? { severity } : {}),
    ...(rule !== undefined ? { rule } : {}),
    ...(col !== undefined ? { col } : {}),
  };
}

let mcpClient: McpClient | null = null;
let diagnostics: vscode.DiagnosticCollection;
let outputChannel: vscode.OutputChannel;
let extensionContext: vscode.ExtensionContext;
let codeLensProvider: FixoraCodeLensProvider;

/** Suggested-fix text for a diagnostic from the standalone AI path, keyed by
 *  `${uri}|${line}|${message}` — read back by the quick-fix `CodeActionProvider`. */
const fixesByKey = new Map<string, string>();

function fixKey(uri: vscode.Uri, line: number, message: string): string {
  return `${uri.toString()}|${String(line)}|${message}`;
}

function fixoraExePath(): string {
  return vscode.workspace.getConfiguration('fixora').get<string>('exePath') ?? 'Fixora.exe';
}

function diagnosticSeverityToString(severity: vscode.DiagnosticSeverity): 'error' | 'warning' | 'info' {
  if (severity === vscode.DiagnosticSeverity.Error) return 'error';
  if (severity === vscode.DiagnosticSeverity.Information || severity === vscode.DiagnosticSeverity.Hint) return 'info';
  return 'warning';
}

function getClient(): McpClient {
  mcpClient ??= new McpClient(fixoraExePath());
  return mcpClient;
}

function hasApiKey(): boolean {
  const key = vscode.workspace.getConfiguration('fixora').get<string>('apiKey') ?? '';
  return key.trim() !== '';
}

/** The single place findings become squiggly diagnostics, for both the MCP path and the standalone
 *  path. A finding with no line number is skipped rather than mis-drawn at line 0. */
function setDiagnostics(document: vscode.TextDocument, findings: readonly FixoraFinding[]): void {
  const result: vscode.Diagnostic[] = [];
  for (const finding of findings) {
    if (typeof finding.line !== 'number') continue;
    const line = Math.max(0, finding.line - 1);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line, finding.col ?? 0, line, Number.MAX_SAFE_INTEGER),
      finding.message,
      finding.severity === 'error'
        ? vscode.DiagnosticSeverity.Error
        : finding.severity === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information,
    );
    diagnostic.source = 'Fixora';
    if (finding.fix !== undefined) {
      fixesByKey.set(fixKey(document.uri, line, finding.message), finding.fix);
      diagnostic.code = 'fixora-ai-fix';
    } else if (finding.rule !== undefined) {
      diagnostic.code = finding.rule;
    }
    result.push(diagnostic);
  }
  diagnostics.set(document.uri, result);
}

/**
 * Analyzes the active file. MCP (the Fixora desktop app) is tried first — it is the richer,
 * verified path — and only on failure (the app is not installed/running) does this fall back to a
 * direct call to the user's own configured AI provider.
 */
async function analyzeActiveFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Fixora: no active file to analyze.');
    return;
  }
  const filePath = editor.document.uri.fsPath;

  // A fresh run replaces whatever the last one showed — never a merge of stale and new findings.
  diagnostics.delete(editor.document.uri);
  codeLensProvider.updateFindings(editor.document.uri, []);

  try {
    const result = (await getClient().callTool('fixora_analyze', { file: filePath })) as {
      findings?: Finding[];
    };
    const normalized = fromMcpFindings(result.findings ?? []);
    setDiagnostics(editor.document, normalized);
    codeLensProvider.updateFindings(editor.document.uri, normalized);
    void vscode.window.showInformationMessage(
      `Fixora: found ${String(normalized.length)} issue(s) in ${editor.document.fileName}.`,
    );
    return;
  } catch {
    // Fixora app not installed/running — fall through to standalone analysis.
  }

  if (!hasApiKey()) {
    const choice = await vscode.window.showInformationMessage(
      'Fixora could not reach the desktop app, and no API key is configured for standalone analysis.',
      'Setup API Key',
    );
    if (choice === 'Setup API Key') runSetup();
    return;
  }

  try {
    const config = vscode.workspace.getConfiguration('fixora');
    const apiKey = config.get<string>('apiKey') ?? '';
    const provider = (config.get<string>('aiProvider') ?? 'openrouter') as AiProvider;
    const model = config.get<string>('model') ?? 'google/gemini-flash-1.5';

    const result = await analyzeCode(editor.document.getText(), filePath, apiKey, provider, model);
    const normalized = fromAnalysisIssues(result.issues);
    setDiagnostics(editor.document, normalized);
    codeLensProvider.updateFindings(editor.document.uri, normalized);
    void vscode.window.showInformationMessage(
      `Fixora (standalone): found ${String(normalized.length)} issue(s) in ${editor.document.fileName}.`,
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`Fixora analyze failed: ${(error as Error).message}`);
  }
}

/** `fromCodeLens` is set when invoked via the "🔧 Fix with Fixora" CodeLens (the finding is passed
 *  as the command argument); otherwise this falls back to the pre-existing cursor-diagnostic
 *  lookup. */
async function repairSelectedIssue(fromCodeLens?: FixoraFinding): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Fixora: no active file.');
    return;
  }
  const filePath = editor.document.uri.fsPath;

  let targetMessage: string;
  let targetLine: number;
  let targetSeverity: 'error' | 'warning' | 'info';
  let targetCode: string | undefined;

  if (fromCodeLens !== undefined) {
    targetMessage = fromCodeLens.message;
    targetLine = fromCodeLens.line;
    targetSeverity = fromCodeLens.severity ?? 'warning';
    targetCode = fromCodeLens.rule;
  } else {
    const cursorDiagnostics = vscode.languages
      .getDiagnostics(editor.document.uri)
      .filter((d) => d.source === 'Fixora' && d.range.contains(editor.selection.active));

    if (cursorDiagnostics.length === 0) {
      void vscode.window.showWarningMessage('Fixora: place the cursor on a Fixora issue first.');
      return;
    }

    const target = cursorDiagnostics[0];
    if (!target) return;
    targetMessage = target.message;
    targetLine = target.range.start.line + 1;
    targetSeverity = diagnosticSeverityToString(target.severity);
    targetCode = typeof target.code === 'string' ? target.code : undefined;
  }

  try {
    await getClient().callTool('fixora_repair', {
      file: filePath,
      findingId: targetCode,
    });
    void vscode.window.showInformationMessage('Fixora: repair applied.');
    await analyzeActiveFile();
    return;
  } catch {
    // Fixora app not installed/running — fall through to standalone repair.
  }

  if (!hasApiKey()) {
    void vscode.window.showErrorMessage(
      'Fixora Desktop not running. Add API key in settings for standalone repair.',
    );
    return;
  }

  try {
    const config = vscode.workspace.getConfiguration('fixora');
    const apiKey = config.get<string>('apiKey') ?? '';
    const provider = (config.get<string>('aiProvider') ?? 'openrouter') as AiProvider;
    const model = config.get<string>('model') ?? 'google/gemini-flash-1.5';

    const result = await repairIssue(
      { message: targetMessage, line: targetLine, severity: targetSeverity },
      editor.document.getText(),
      filePath,
      apiKey,
      provider,
      model,
    );

    const doc = await vscode.workspace.openTextDocument({
      content: result.repairedCode,
      language: editor.document.languageId,
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    void vscode.window.showInformationMessage(`Fixora (standalone): ${result.explanation}`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Fixora repair failed: ${(error as Error).message}`);
  }
}

/** `fromCodeLens` — see `repairSelectedIssue`'s doc; same CodeLens-argument path. */
async function explainSelectedIssue(fromCodeLens?: FixoraFinding): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Fixora: no active file.');
    return;
  }
  const filePath = editor.document.uri.fsPath;

  let targetMessage: string;
  let targetLine: number;
  let targetCode: string | undefined;

  if (fromCodeLens !== undefined) {
    targetMessage = fromCodeLens.message;
    targetLine = fromCodeLens.line;
    targetCode = fromCodeLens.rule;
  } else {
    const cursorDiagnostics = vscode.languages
      .getDiagnostics(editor.document.uri)
      .filter((d) => d.source === 'Fixora' && d.range.contains(editor.selection.active));

    if (cursorDiagnostics.length === 0) {
      void vscode.window.showWarningMessage('Fixora: place the cursor on a Fixora issue first.');
      return;
    }

    const target = cursorDiagnostics[0];
    if (!target) return;
    targetMessage = target.message;
    targetLine = target.range.start.line + 1;
    targetCode = typeof target.code === 'string' ? target.code : undefined;
  }

  try {
    const findings = await getClient().callTool('fixora_findings', { file: filePath });
    const explanation = await getClient().callTool('fixora_analyze', {
      file: filePath,
      findingId: targetCode,
      explain: true,
    });
    outputChannel.clear();
    outputChannel.appendLine(`Fixora explanation — ${filePath}`);
    outputChannel.appendLine('');
    outputChannel.appendLine(JSON.stringify({ findings, explanation }, null, 2));
    outputChannel.show(true);
    return;
  } catch {
    // Fixora app not installed/running — fall through to standalone explain.
  }

  if (!hasApiKey()) {
    void vscode.window.showErrorMessage(
      'Fixora Desktop not running. Add API key in settings for standalone explain.',
    );
    return;
  }

  try {
    const config = vscode.workspace.getConfiguration('fixora');
    const apiKey = config.get<string>('apiKey') ?? '';
    const provider = (config.get<string>('aiProvider') ?? 'openrouter') as AiProvider;
    const model = config.get<string>('model') ?? 'google/gemini-flash-1.5';

    const explanation = await explainIssue(
      { message: targetMessage, line: targetLine, ...(targetCode !== undefined ? { rule: targetCode } : {}) },
      editor.document.getText(),
      apiKey,
      provider,
      model,
    );

    outputChannel.clear();
    outputChannel.appendLine(`Fixora explanation (standalone) — ${filePath}`);
    outputChannel.appendLine('');
    outputChannel.appendLine(explanation);
    outputChannel.show(true);
  } catch (error) {
    void vscode.window.showErrorMessage(`Fixora explain failed: ${(error as Error).message}`);
  }
}

function openApp(): void {
  try {
    spawn(fixoraExePath(), [], { detached: true, stdio: 'ignore' }).unref();
  } catch (error) {
    void vscode.window.showErrorMessage(`Failed to launch Fixora: ${(error as Error).message}`);
  }
}

function runSetup(): void {
  openSetupWebview(extensionContext, () => {
    void analyzeActiveFile();
  });
}

/** Offers the AI-suggested replacement (`ai-client.ts`'s `fix`) as a quick fix on the squiggly. */
class FixoraCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== 'fixora-ai-fix') continue;
      const line = diagnostic.range.start.line;
      const fix = fixesByKey.get(fixKey(document.uri, line, diagnostic.message));
      if (fix === undefined) continue;

      const action = new vscode.CodeAction('Fixora: Apply suggested fix', vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      action.edit = new vscode.WorkspaceEdit();
      action.edit.replace(document.uri, document.lineAt(line).range, fix);
      actions.push(action);
    }
    return actions;
  }
}

/** Inline "🔧 Fix with Fixora" / "💬 Explain" action buttons above each finding's line, driven by
 *  whatever `analyzeActiveFile` last found for that document. */
class FixoraCodeLensProvider implements vscode.CodeLensProvider {
  private readonly findings = new Map<string, FixoraFinding[]>();
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  updateFindings(uri: vscode.Uri, findings: FixoraFinding[]): void {
    this.findings.set(uri.toString(), findings);
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const findings = this.findings.get(document.uri.toString()) ?? [];
    const lenses: vscode.CodeLens[] = [];
    for (const finding of findings) {
      if (typeof finding.line !== 'number') continue;
      const range = new vscode.Range(Math.max(0, finding.line - 1), 0, Math.max(0, finding.line - 1), 0);
      lenses.push(
        new vscode.CodeLens(range, {
          title: '🔧 Fix with Fixora',
          command: 'fixora.repair',
          arguments: [finding],
        }),
      );
      lenses.push(
        new vscode.CodeLens(range, {
          title: '💬 Explain',
          command: 'fixora.explain',
          arguments: [finding],
        }),
      );
    }
    return lenses;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  diagnostics = vscode.languages.createDiagnosticCollection('fixora');
  outputChannel = vscode.window.createOutputChannel('Fixora');
  codeLensProvider = new FixoraCodeLensProvider();

  if (!hasApiKey()) {
    void vscode.window
      .showInformationMessage(
        'Fixora: set up an API key to analyze code even when the desktop app is not running.',
        'Setup API Key',
      )
      .then((choice) => {
        if (choice === 'Setup API Key') runSetup();
      });
  }

  context.subscriptions.push(
    diagnostics,
    outputChannel,
    vscode.commands.registerCommand('fixora.analyze', analyzeActiveFile),
    vscode.commands.registerCommand('fixora.repair', (arg: unknown) => repairSelectedIssue(asFixoraFinding(arg))),
    vscode.commands.registerCommand('fixora.explain', (arg: unknown) => explainSelectedIssue(asFixoraFinding(arg))),
    vscode.commands.registerCommand('fixora.openApp', openApp),
    vscode.commands.registerCommand('fixora.setup', runSetup),
    vscode.languages.registerCodeActionsProvider('*', new FixoraCodeActionProvider(), {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider),
    vscode.workspace.onWillSaveTextDocument((event) => {
      const autoAnalyze = vscode.workspace.getConfiguration('fixora').get<boolean>('autoAnalyze');
      if (autoAnalyze && event.document === vscode.window.activeTextEditor?.document) {
        void analyzeActiveFile();
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
    }),
  );
}

export function deactivate(): void {
  mcpClient?.dispose();
  mcpClient = null;
}
