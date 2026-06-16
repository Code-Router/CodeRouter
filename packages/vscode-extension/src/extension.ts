import * as vscode from 'vscode';
import { cliShellCommand, resolveCli } from './cli.js';
import { DashboardServer } from './dashboard.js';
import { DashboardPanel } from './panel.js';
import { SidebarProvider } from './sidebar.js';

let dashboard: DashboardServer | undefined;
let terminal: vscode.Terminal | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const cwd = workspaceCwd();
  dashboard = new DashboardServer(cwd);
  context.subscriptions.push(dashboard);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, new SidebarProvider(), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('coderouter.openChat', openChat),
    vscode.commands.registerCommand('coderouter.openDashboard', () => openDashboard(false)),
    vscode.commands.registerCommand('coderouter.openDashboardInBrowser', () => openDashboard(true)),
    vscode.commands.registerCommand('coderouter.restartDashboard', restartDashboard),
  );

  // Drop our terminal reference when the user closes it.
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      if (t === terminal) terminal = undefined;
    }),
  );
}

export function deactivate(): void {
  dashboard?.dispose();
  dashboard = undefined;
}

function openChat(): void {
  const inv = resolveCli();
  if (!terminal || terminal.exitStatus !== undefined) {
    terminal = vscode.window.createTerminal({ name: 'CodeRouter', cwd: workspaceCwd() });
  }
  terminal.show();
  terminal.sendText(cliShellCommand(inv), true);
}

async function openDashboard(inBrowser: boolean): Promise<void> {
  if (!dashboard) return;
  try {
    const url = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Starting CodeRouter dashboard…' },
      () => dashboard!.ensure(),
    );
    if (inBrowser) {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } else {
      DashboardPanel.show(url, vscode.ViewColumn.Beside);
    }
  } catch (err) {
    void vscode.window.showErrorMessage(
      `CodeRouter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function restartDashboard(): Promise<void> {
  if (!dashboard) return;
  try {
    const url = await dashboard.restart();
    DashboardPanel.show(url, vscode.ViewColumn.Beside);
    void vscode.window.showInformationMessage('CodeRouter dashboard restarted.');
  } catch (err) {
    void vscode.window.showErrorMessage(
      `CodeRouter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function workspaceCwd(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}
