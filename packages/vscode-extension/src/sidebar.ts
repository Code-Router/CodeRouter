import * as vscode from 'vscode';

/**
 * The activity-bar sidebar view: a compact launcher with buttons that
 * fire the extension commands. Kept intentionally simple — the rich UI
 * lives in the dashboard panel and the chat REPL in the terminal.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'coderouter.home';

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: { command?: string }) => {
      if (msg?.command) void vscode.commands.executeCommand(msg.command);
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 14px 12px; }
    .title { font-weight: 600; font-size: 13px; margin-bottom: 2px; }
    .blurb { color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 16px; line-height: 1.5; }
    button {
      display: flex; align-items: center; gap: 8px; width: 100%;
      text-align: left; border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
      padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; margin-bottom: 8px;
    }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    .hint { color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 14px; line-height: 1.5; }
    code { background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="title">CodeRouter</div>
  <div class="blurb">Route every coding task to the best model.</div>

  <button class="primary" data-cmd="coderouter.openChat">▸ Open Chat</button>
  <button data-cmd="coderouter.openDashboard">▸ Open Dashboard</button>
  <button data-cmd="coderouter.openDashboardInBrowser">▸ Dashboard in Browser</button>

  <div class="hint">Chat opens a terminal running the CodeRouter REPL in your workspace. The dashboard shows live usage, cost, and settings.</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    for (const b of document.querySelectorAll('button')) {
      b.addEventListener('click', () => vscode.postMessage({ command: b.dataset.cmd }));
    }
  </script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
