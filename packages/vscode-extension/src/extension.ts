import { spawn } from 'child_process';

import * as vscode from 'vscode';

import { McpClient } from './mcp-client.js';

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

export function activate(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection('fixora');
  outputChannel = vscode.window.createOutputChannel('Fixora');

  context.subscriptions.push(
    diagnostics,
    outputChannel,
    vscode.commands.registerCommand('fixora.analyze', analyzeActiveFile),
    vscode.commands.registerCommand('fixora.repair', repairSelectedIssue),
    vscode.commands.registerCommand('fixora.explain', explainSelectedIssue),
    vscode.commands.registerCommand('fixora.openApp', openApp),
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
