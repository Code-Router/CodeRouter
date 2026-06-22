import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';

/**
 * CodeRouter Studio — Electron main process.
 *
 * Responsibilities:
 *  - Ensure the persistent CodeRouter daemon is running (spawn `coderouter
 *    daemon` detached if not), so loops keep running after the window
 *    closes.
 *  - Create the window and load the renderer (Vite dev server in dev,
 *    built files in prod).
 *  - Expose the resolved daemon URL to the renderer over typed IPC.
 */

const DEFAULT_PORT = 4329;
const isDev = !!process.env.VITE_DEV_SERVER_URL;

type DaemonInfo = { port: number; pid: number; startedAt: number; version: string };

function coderouterHome(): string {
  return process.env.CODEROUTER_HOME || join(homedir(), '.coderouter');
}

function readDaemonInfo(): DaemonInfo | null {
  try {
    return JSON.parse(readFileSync(join(coderouterHome(), 'daemon.json'), 'utf8')) as DaemonInfo;
  } catch {
    return null;
  }
}

async function ping(port: number): Promise<DaemonInfo | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok ? ((await res.json()) as DaemonInfo) : null;
  } catch {
    return null;
  }
}

/**
 * Locate a standalone Node binary. The daemon must run under regular Node
 * (not Electron's bundled Node) so native addons like `node-pty` — which
 * powers the Studio terminal and ships a prebuilt binary for the standard
 * Node ABI — load correctly. Returns null if none can be found.
 */
function findNode(): string | null {
  const candidates = [
    process.env.CODEROUTER_NODE,
    process.env.npm_node_execpath,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ];
  for (const c of candidates) {
    if (c && existsSync(c) && !/electron/i.test(c)) return c;
  }
  return null;
}

/** Resolve the command used to spawn the daemon. */
function resolveCli(): { cmd: string; args: string[]; electronNode: boolean } {
  const cliPath = process.env.CODEROUTER_CLI || (() => {
    const local = join(app.getAppPath(), '..', 'cli', 'dist', 'cli.js');
    return existsSync(local) ? local : null;
  })();

  if (cliPath) {
    const node = findNode();
    // Prefer standalone Node so node-pty loads; fall back to Electron-as-Node
    // (the daemon still works, only the terminal backend would be unavailable).
    if (node) return { cmd: node, args: [cliPath], electronNode: false };
    return { cmd: process.execPath, args: [cliPath], electronNode: true };
  }
  return { cmd: 'coderouter', args: [], electronNode: false };
}

async function ensureDaemon(): Promise<DaemonInfo> {
  const envUrl = process.env.CODEROUTER_DAEMON_URL;
  if (envUrl) {
    const port = Number(new URL(envUrl).port || DEFAULT_PORT);
    const alive = await ping(port);
    if (alive) return alive;
  }

  const existing = readDaemonInfo();
  if (existing) {
    const alive = await ping(existing.port);
    if (alive) return alive;
  }

  const { cmd, args, electronNode } = resolveCli();
  // When falling back to Electron's own binary, it must be told to behave as
  // plain Node, otherwise it boots a second app instance.
  const child = spawn(cmd, [...args, 'daemon'], {
    detached: true,
    stdio: 'ignore',
    env: electronNode ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
  });
  child.unref();

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    const info = readDaemonInfo();
    if (info) {
      const alive = await ping(info.port);
      if (alive) return alive;
    }
  }
  // Last resort: assume default port (renderer will show disconnected).
  return { port: DEFAULT_PORT, pid: 0, startedAt: Date.now(), version: 'unknown' };
}

let daemonUrl = `http://127.0.0.1:${DEFAULT_PORT}`;
let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  // Window icon for dev (Linux/Windows taskbar). Packaged builds use the
  // electron-builder icon from build/. Guard so a missing file is harmless.
  const iconPath = join(__dirname, '..', 'build', 'icon.png');
  const icon = existsSync(iconPath) ? iconPath : undefined;
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 920,
    minHeight: 600,
    backgroundColor: '#0b0d12',
    title: 'CodeRouter Studio',
    icon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  }
}

ipcMain.handle('daemon:url', () => daemonUrl);

ipcMain.handle('dialog:pickFolder', async () => {
  const opts = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
  const res = mainWindow
    ? await dialog.showOpenDialog(mainWindow, opts)
    : await dialog.showOpenDialog(opts);
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
});

app.whenReady().then(async () => {
  const info = await ensureDaemon();
  daemonUrl = `http://127.0.0.1:${info.port}`;
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  // The daemon intentionally keeps running so loops continue. Quit the
  // UI process only (on non-macOS quit the app).
  if (process.platform !== 'darwin') app.quit();
});

void isDev;
