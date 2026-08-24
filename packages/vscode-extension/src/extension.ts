import { spawn } from 'child_process';

import * as vscode from 'vscode';

import { analyzeCode, type AiProvider, type AnalysisIssue } from './ai-client.js';
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

let mcpClient: McpClient | null = null;
let diagnostics: vscode.DiagnosticCollection;
let outputChannel: vscode.OutputChannel;
let extensionContext: vscode.ExtensionContext;

/** Suggested-fix text for a diagnostic from the standalone AI path, keyed by
 *  `${uri}|${line}|${message}` — read back by the quick-fix `CodeActionProvider`. */
const fixesByKey = new Map<string, string>();

function fixKey(uri: vscode.Uri, line: number, message: string): string {
  return `${uri.toString()}|${String(line)}|${message}`;
}

function fixoraExePath(): string {
  return vscode.workspace.getConfiguration('fixora').get<string>('exePath') ?? 'Fixora.exe';
}

function severityToVsCode(severity: Finding['severity']): vscode.DiagnosticSeverity {
  if (severity === 'error') return vscode.DiagnosticSeverity.Error;
  if (severity === 'info') return vscode.DiagnosticSeverity.Information;
  return vscode.DiagnosticSeverity.Warning;
}

function getClient(): McpClient {
  mcpClient ??= new McpClient(fixoraExePath());
  return mcpClient;
}

function hasApiKey(): boolean {
  const key = vscode.workspace.getConfiguration('fixora').get<string>('apiKey') ?? '';
  return key.trim() !== '';
}

function standaloneDiagnostics(uri: vscode.Uri, issues: readonly AnalysisIssue[]): vscode.Diagnostic[] {
  return issues.map((issue) => {
    const line = Math.max(0, issue.line - 1);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
      issue.message,
      severityToVsCode(issue.severity),
    );
    diagnostic.source = 'Fixora (AI)';
    if (issue.fix !== undefined) {
      fixesByKey.set(fixKey(uri, line, issue.message), issue.fix);
      diagnostic.code = 'fixora-ai-fix';
    }
    return diagnostic;
  });
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

  try {
    const result = (await getClient().callTool('fixora_analyze', { file: filePath })) as {
      findings?: Finding[];
    };
    const findings = result.findings ?? [];

    const fileDiagnostics = findings.map((finding) => {
      const line = Math.max(0, finding.line - 1);
      const startCol = Math.max(0, finding.column ?? 0);
      const endLine = finding.endLine ? Math.max(0, finding.endLine - 1) : line;
      const endCol = finding.endColumn ?? startCol + 1;
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(line, startCol, endLine, endCol),
        finding.message,
        severityToVsCode(finding.severity),
      );
      diagnostic.source = 'Fixora';
      if (finding.id !== undefined) diagnostic.code = finding.id;
      return diagnostic;
    });

    diagnostics.set(editor.document.uri, fileDiagnostics);
    void vscode.window.showInformationMessage(
      `Fixora: found ${String(fileDiagnostics.length)} issue(s) in ${editor.document.fileName}.`,
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
    diagnostics.set(editor.document.uri, standaloneDiagnostics(editor.document.uri, result.issues));
    void vscode.window.showInformationMessage(
      `Fixora (standalone): found ${String(result.issues.length)} issue(s) in ${editor.document.fileName}.`,
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`Fixora analyze failed: ${(error as Error).message}`);
  }
}

async function repairSelectedIssue(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Fixora: no active file.');
    return;
  }
  const filePath = editor.document.uri.fsPath;
  const cursorDiagnostics = vscode.languages
    .getDiagnostics(editor.document.uri)
    .filter((d) => d.source === 'Fixora' && d.range.contains(editor.selection.active));

  if (cursorDiagnostics.length === 0) {
    void vscode.window.showWarningMessage('Fixora: place the cursor on a Fixora issue first.');
    return;
  }

  const target = cursorDiagnostics[0];
  if (!target) return;

  try {
    await getClient().callTool('fixora_repair', {
      file: filePath,
      findingId: target.code,
    });
    void vscode.window.showInformationMessage('Fixora: repair applied.');
    await analyzeActiveFile();
  } catch (error) {
    void vscode.window.showErrorMessage(`Fixora repair failed: ${(error as Error).message}`);
  }
}

async function explainSelectedIssue(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Fixora: no active file.');
    return;
  }
  const filePath = editor.document.uri.fsPath;
  const cursorDiagnostics = vscode.languages
    .getDiagnostics(editor.document.uri)
    .filter((d) => d.source === 'Fixora' && d.range.contains(editor.selection.active));

  if (cursorDiagnostics.length === 0) {
    void vscode.window.showWarningMessage('Fixora: place the cursor on a Fixora issue first.');
    return;
  }

  const target = cursorDiagnostics[0];
  if (!target) return;

  try {
    const findings = await getClient().callTool('fixora_findings', { file: filePath });
    const explanation = await getClient().callTool('fixora_analyze', {
      file: filePath,
      findingId: target.code,
      explain: true,
    });
    outputChannel.clear();
    outputChannel.appendLine(`Fixora explanation — ${filePath}`);
    outputChannel.appendLine('');
    outputChannel.appendLine(JSON.stringify({ findings, explanation }, null, 2));
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

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  diagnostics = vscode.languages.createDiagnosticCollection('fixora');
  outputChannel = vscode.window.createOutputChannel('Fixora');

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
    vscode.commands.registerCommand('fixora.repair', repairSelectedIssue),
    vscode.commands.registerCommand('fixora.explain', explainSelectedIssue),
    vscode.commands.registerCommand('fixora.openApp', openApp),
    vscode.commands.registerCommand('fixora.setup', runSetup),
    vscode.languages.registerCodeActionsProvider('*', new FixoraCodeActionProvider(), {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.workspace.onWillSaveTextDocument((event) => {
      const autoAnalyze = vscode.workspace.getConfiguration('fixora').get<boolean>('autoAnalyze');
      if (autoAnalyze && event.document === vscode.window.activeTextEditor?.document) {
        void analyzeActiveFile();
      }
    }),
  );
}

export function deactivate(): void {
  mcpClient?.dispose();
  mcpClient = null;
}
