import { chmodSync, existsSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Duplex } from 'node:stream';

/**
 * Real PTY terminal for CodeRouter Studio.
 *
 * The daemon spawns a genuine pseudo-terminal (via `node-pty`) and relays
 * it over a WebSocket so the Studio terminal panel behaves like a normal
 * shell window — persistent session, full line editing, colors, vim, etc.
 * (The old per-command `bash -lc` exec endpoint re-sourced the login shell
 * on every keystroke-line, which is why it felt slow and "custom".)
 *
 * `node-pty` (native) and `ws` are loaded lazily so the rest of the daemon
 * still boots if a prebuilt binary is unavailable on some platform.
 */

// Minimal structural types so we don't hard-depend on the libs at build time.
type PtyProcess = {
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: () => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
};
type PtyModule = {
  spawn: (
    file: string,
    args: string[] | string,
    opts: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
  ) => PtyProcess;
};
type WsLike = {
  send: (data: string) => void;
  close: () => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};
type WebSocketServerCtor = new (opts: { noServer: true }) => {
  handleUpgrade: (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    cb: (ws: WsLike) => void,
  ) => void;
};

let depsPromise: Promise<{ WebSocketServer: WebSocketServerCtor; pty: PtyModule }> | null = null;

async function loadDeps(): Promise<{ WebSocketServer: WebSocketServerCtor; pty: PtyModule }> {
  if (!depsPromise) {
    depsPromise = (async () => {
      const [wsMod, ptyMod] = await Promise.all([import('ws'), import('node-pty')]);
      const WebSocketServer = (wsMod as { WebSocketServer: WebSocketServerCtor }).WebSocketServer;
      const pty = ptyMod as unknown as PtyModule;
      return { WebSocketServer, pty };
    })();
  }
  return depsPromise;
}

let wss: InstanceType<WebSocketServerCtor> | null = null;
let helperFixed = false;

/**
 * node-pty's prebuilt `spawn-helper` is sometimes extracted without the
 * execute bit, which makes `posix_spawnp` fail. Self-heal it once.
 */
function ensureSpawnHelperExecutable(): void {
  if (helperFixed || process.platform === 'win32') {
    helperFixed = true;
    return;
  }
  helperFixed = true;
  try {
    const req = createRequire(import.meta.url);
    const pkg = req.resolve('node-pty/package.json');
    const helper = join(dirname(pkg), 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
    if (existsSync(helper)) chmodSync(helper, 0o755);
  } catch {
    /* best effort */
  }
}

/** Handle an HTTP upgrade for `/api/pty`. Resolves once the socket closes. */
export async function handlePtyUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  daemonCwd: string,
): Promise<void> {
  let deps: { WebSocketServer: WebSocketServerCtor; pty: PtyModule };
  try {
    deps = await loadDeps();
  } catch {
    socket.destroy();
    return;
  }
  ensureSpawnHelperExecutable();
  if (!wss) wss = new deps.WebSocketServer({ noServer: true });
  wss.handleUpgrade(req, socket, head, (ws) => startSession(ws, deps.pty, req, daemonCwd));
}

function startSession(ws: WsLike, pty: PtyModule, req: IncomingMessage, daemonCwd: string): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let cwd = url.searchParams.get('cwd') || daemonCwd;
  if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) cwd = daemonCwd;
  const cols = clampDim(url.searchParams.get('cols'), 80);
  const rows = clampDim(url.searchParams.get('rows'), 24);
  const shell =
    process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash');

  let term: PtyProcess;
  try {
    term = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
  } catch {
    try {
      ws.send('\r\n\x1b[31mFailed to start a shell.\x1b[0m\r\n');
      ws.close();
    } catch {
      /* ignore */
    }
    return;
  }

  term.onData((data) => {
    try {
      ws.send(data);
    } catch {
      /* client gone */
    }
  });
  term.onExit(() => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });

  ws.on('message', (raw: unknown) => {
    let msg: { t?: string; d?: string; c?: number; r?: number };
    try {
      msg = JSON.parse(String(raw)) as typeof msg;
    } catch {
      return;
    }
    if (msg.t === 'i' && typeof msg.d === 'string') term.write(msg.d);
    else if (msg.t === 'r') term.resize(clampDim(msg.c, 80), clampDim(msg.r, 24));
  });

  const dispose = (): void => {
    try {
      term.kill();
    } catch {
      /* already gone */
    }
  };
  ws.on('close', dispose);
  ws.on('error', dispose);
}

function clampDim(value: string | number | null | undefined, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 1000);
}
