import * as vscode from 'vscode';

interface SaveMessage {
  type: 'save';
  apiKey: string;
  aiProvider: string;
  model: string;
}

function nonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function html(webviewNonce: string, cspSource: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${webviewNonce}';" />
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); }
    h2 { margin-top: 0; }
    label { display: block; margin-top: 14px; margin-bottom: 4px; font-size: 12px; }
    input, select {
      width: 100%; box-sizing: border-box; padding: 6px 8px;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
    }
    button {
      margin-top: 18px; padding: 8px 14px; cursor: pointer;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    p.hint { font-size: 12px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h2>🛡️ Fixora Setup</h2>
  <p class="hint">Analyze code without the Fixora desktop app — bring your own API key.</p>

  <label for="provider">AI Provider</label>
  <select id="provider">
    <option value="openrouter" selected>OpenRouter (recommended — cheapest, all models)</option>
    <option value="openai">OpenAI</option>
    <option value="anthropic">Anthropic</option>
    <option value="gemini">Google Gemini</option>
  </select>

  <label for="model">Model</label>
  <input id="model" type="text" value="google/gemini-flash-1.5" />

  <label for="apiKey">API Key</label>
  <input id="apiKey" type="password" placeholder="sk-..." />

  <button id="save">Save &amp; Start Analyzing</button>

  <script nonce="${webviewNonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('save').addEventListener('click', () => {
      vscode.postMessage({
        type: 'save',
        apiKey: document.getElementById('apiKey').value,
        aiProvider: document.getElementById('provider').value,
        model: document.getElementById('model').value,
      });
    });
  </script>
</body>
</html>`;
}

/** First-time setup: API key + provider, saved straight to the `fixora.*` settings the rest of the
 *  extension reads (ai-client.ts, extension.ts). */
export function openSetupWebview(context: vscode.ExtensionContext, onSaved: () => void): void {
  const panel = vscode.window.createWebviewPanel(
    'fixoraSetup',
    'Fixora Setup',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: false },
  );
  panel.webview.html = html(nonce(), panel.webview.cspSource);

  panel.webview.onDidReceiveMessage(
    (message: SaveMessage) => {
      if (message.type !== 'save') return;
      const config = vscode.workspace.getConfiguration('fixora');
      void Promise.all([
        config.update('apiKey', message.apiKey, vscode.ConfigurationTarget.Global),
        config.update('aiProvider', message.aiProvider, vscode.ConfigurationTarget.Global),
        config.update('model', message.model, vscode.ConfigurationTarget.Global),
      ]).then(() => {
        void vscode.window.showInformationMessage('Fixora: API key saved.');
        panel.dispose();
        onSaved();
      });
    },
    undefined,
    context.subscriptions,
  );
}
