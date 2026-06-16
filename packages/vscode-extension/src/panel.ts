import * as vscode from 'vscode';

/**
 * A singleton editor-area webview panel that embeds the local dashboard
 * (served by the CLI on loopback) inside an iframe. Opening it again
 * reveals the existing panel rather than spawning a second one.
 */
export class DashboardPanel {
  private static current: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  static show(url: string, column: vscode.ViewColumn): void {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(column);
      DashboardPanel.current.setUrl(url);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'coderouter.dashboard',
      'CodeRouter Dashboard',
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    DashboardPanel.current = new DashboardPanel(panel, url);
  }

  private constructor(panel: vscode.WebviewPanel, url: string) {
    this.panel = panel;
    this.setUrl(url);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private setUrl(url: string): void {
    this.panel.webview.html = html(url);
  }

  private dispose(): void {
    DashboardPanel.current = undefined;
    this.panel.dispose();
    for (const d of this.disposables.splice(0)) d.dispose();
  }
}

function html(url: string): string {
  const safe = url.replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src http://127.0.0.1:* http://localhost:*;" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #0d1117; }
    iframe { border: 0; width: 100%; height: 100vh; display: block; }
  </style>
</head>
<body>
  <iframe src="${safe}" title="CodeRouter Dashboard" allow="clipboard-read; clipboard-write"></iframe>
</body>
</html>`;
}
