import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ChatMessage, Effort, LoopEvent, LoopSpec, LoopPreset, Mode } from '@coderouter/core';
import { PRESETS, discoverVerifiers, generateLoopSpec, openStore, resolveDbPath, validateLoopSpec } from '@coderouter/core';
import { CLI_VERSION } from '../version.js';
import { handle as handleDashboard, readJson, sendJson } from '../dashboard/server.js';
import { buildExecutionEnv, executeRun } from '../runtime.js';
import { buildAllLoops, buildChatDetail, buildChatsReport, buildProjectsReport } from './data.js';
import {
  clearDaemonInfo,
  DEFAULT_DAEMON_PORT,
  writeDaemonInfo,
} from './lockfile.js';
import { handlePtyUpgrade } from './pty.js';
import { getSupervisor } from './supervisor.js';
import { assertWithinSpendingLimit } from '../spend.js';

/**
 * CodeRouter daemon ("app-server").
 *
 * A long-lived, loopback-only Node process that supervises loops (they
 * keep running after any UI closes), persists chat history, and serves a
 * JSON API + a Server-Sent-Events stream of loop events. It is a superset
 * of the dashboard: any route it doesn't own is delegated to the existing
 * dashboard handler, so usage/settings/plugins/models keep working and
 * the legacy dashboard SPA is still served at `/`.
 *
 * We use SSE (not WebSocket) for the event stream: loop events are
 * one-directional server->client, SSE needs no extra dependency, and all
 * control actions (pause/resume/stop/approve) are plain POSTs.
 */

export type DaemonHandle = {
  port: number;
  url: string;
  close: () => Promise<void>;
};

// Live SSE clients. The supervisor broadcasts every loop event to each.
const sseClients = new Set<ServerResponse>();
let supervisorWired = false;

function wireSupervisor(): void {
  if (supervisorWired) return;
  supervisorWired = true;
  getSupervisor().subscribe((e: LoopEvent) => broadcast(e));
}

function broadcast(event: LoopEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

/**
 * Daemon CSRF/CORS posture: loopback-bound, so we accept requests with no
 * Origin, a loopback Origin, a `null`/`file:` Origin (Electron prod), and
 * reflect the Origin for CORS so the Electron renderer (file:// or the
 * Vite dev origin) can call the API.
 */
function allowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return true;
  try {
    const url = new URL(origin);
    if (url.protocol === 'file:') return true;
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  } catch {
    return false;
  }
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin && origin !== 'null' ? origin : '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

export async function startDaemon(opts: { cwd: string; port?: number } = { cwd: process.cwd() }): Promise<DaemonHandle> {
  const cwd = opts.cwd;
  wireSupervisor();

  const server = createServer((req, res) => {
    applyCors(req, res);
    if ((req.method ?? 'GET') === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    handleRequest(req, res, cwd).catch((err) => {
      try {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } catch {
        // response already sent
      }
    });
  });

  // Real PTY terminal for Studio: upgrade `/api/pty` to a WebSocket and
  // relay a genuine pseudo-terminal session (see daemon/pty.ts).
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/api/pty' && allowedOrigin(req)) {
      void handlePtyUpgrade(req, socket, head, cwd);
    } else {
      socket.destroy();
    }
  });

  const port = await listen(server, opts.port ?? DEFAULT_DAEMON_PORT);
  writeDaemonInfo({ port, pid: process.pid, startedAt: Date.now(), version: CLI_VERSION });

  const cleanup = (): void => clearDaemonInfo();
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of sseClients) c.end();
        sseClients.clear();
        clearDaemonInfo();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function listen(server: Server, preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (p: number, attemptsLeft: number): void => {
      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
          tryPort(p + 1, attemptsLeft - 1);
        } else {
          reject(err);
        }
      };
      const onListening = (): void => {
        server.removeListener('error', onError);
        resolve((server.address() as AddressInfo).port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, '127.0.0.1');
    };
    tryPort(preferred, 10);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, cwd: string): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;

  // ---- health / events -------------------------------------------
  if (method === 'GET' && path === '/api/health') {
    sendJson(res, 200, { ok: true, pid: process.pid, version: CLI_VERSION, port: (req.socket.localPort ?? 0), uptime: process.uptime() });
    return;
  }

  if (method === 'GET' && path === '/api/loops/events') {
    openSse(req, res);
    return;
  }

  // ---- projects / chats ------------------------------------------
  if (method === 'GET' && path === '/api/projects') {
    sendJson(res, 200, await buildProjectsReport(cwd));
    return;
  }

  if (method === 'GET' && path === '/api/chats') {
    const project = url.searchParams.get('cwd') ?? undefined;
    sendJson(res, 200, await buildChatsReport(cwd, project));
    return;
  }

  if (method === 'GET' && path === '/api/chat') {
    const project = url.searchParams.get('cwd');
    const id = url.searchParams.get('id');
    if (!project || !id) return sendJson(res, 400, { error: 'cwd and id required' });
    const detail = await buildChatDetail(project, id);
    return sendJson(res, detail ? 200 : 404, detail ?? { error: 'not found' });
  }

  // POST /api/chat/send -> run one conversation turn, streaming the
  // model's answer back as SSE-style chunks. Reuses the same agent
  // execution path as the CLI so chats route, persist, and bill identically.
  if (method === 'POST' && path === '/api/chat/send') {
    if (!allowedOrigin(req)) return sendJson(res, 403, { error: 'cross-origin request rejected' });
    return handleChatSend(req, res, cwd);
  }

  // POST /api/exec -> run a shell command in a project dir, streaming
  // stdout/stderr back as SSE frames. Powers the Studio terminal panel.
  if (method === 'POST' && path === '/api/exec') {
    if (!allowedOrigin(req)) return sendJson(res, 403, { error: 'cross-origin request rejected' });
    return handleExec(req, res, cwd);
  }

  // ---- loops ------------------------------------------------------
  if (path === '/api/loops' || path.startsWith('/api/loops/')) {
    const handled = await handleLoops(req, res, cwd, method, path, url);
    if (handled) return;
  }

  // ---- delegate everything else to the dashboard -----------------
  await handleDashboard(req, res, cwd);
}

const VALID_MODES = new Set<Mode>(['plan', 'masterplan', 'agent', 'debug', 'review', 'orchestrate']);
const VALID_EFFORTS = new Set<Effort>(['low', 'medium', 'high', 'max']);

/**
 * Run a single chat turn and stream the answer. We open an SSE-style
 * response (text/event-stream) and forward every adapter chunk as it
 * lands, then a terminal `done` event with the routed model + usage.
 * `executeRun` persists both the user prompt and the assistant reply to
 * the chat store, so the conversation shows up in history automatically.
 */
async function handleChatSend(req: IncomingMessage, res: ServerResponse, daemonCwd: string): Promise<void> {
  const body = await readJson(req);
  const project = String(body.cwd ?? daemonCwd);
  const prompt = String(body.prompt ?? '').trim();
  const sessionId = String(body.sessionId ?? randomUUID());
  const mode: Mode = VALID_MODES.has(body.mode as Mode) ? (body.mode as Mode) : 'agent';
  const effort: Effort | undefined = VALID_EFFORTS.has(body.effort as Effort) ? (body.effort as Effort) : undefined;

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'access-control-allow-origin': req.headers.origin && req.headers.origin !== 'null' ? req.headers.origin : '*',
  });
  const send = (o: unknown): void => {
    try {
      res.write(`data: ${JSON.stringify(o)}\n\n`);
    } catch {
      // client gone
    }
  };

  if (!prompt) {
    send({ type: 'error', error: 'prompt required' });
    res.end();
    return;
  }

  send({ type: 'start', sessionId });
  try {
    // Prior turns give the agent multi-turn memory. Read them before the
    // run persists this turn.
    const store = await openStore(resolveDbPath(project));
    const prior = store.chats.messages(sessionId).map((m) => ({ role: m.role, content: m.text }) as ChatMessage);
    store.db.close();

    const { output } = await executeRun({
      cwd: project,
      prompt,
      mode,
      effort,
      sessionId,
      apply: false,
      onChunk: (text) => send({ type: 'chunk', text }),
      priorMessages: prior,
    });

    const route = (output.routes ?? [])[0];
    send({
      type: 'done',
      sessionId,
      text: output.text ?? '',
      runId: output.runId,
      route: route ? `${route.via ?? route.provider},${route.model}` : null,
      costUsd: output.costUsd,
      tokensIn: output.tokensIn,
      tokensOut: output.tokensOut,
      diff: output.diff ?? null,
      filesChanged: output.filesChanged ?? [],
    });
  } catch (e) {
    send({ type: 'error', error: e instanceof Error ? e.message : String(e) });
  }
  res.end();
}

/**
 * Run one shell command in a project directory and stream its output.
 * Each command is its own short-lived `bash -lc` (or `cmd /c`) process —
 * not a persistent PTY — so the client tracks `cwd` itself and sends it
 * with every command. Good enough for git/npm/ls/test workflows.
 */
function handleExec(req: IncomingMessage, res: ServerResponse, daemonCwd: string): void {
  void readJson(req).then((body) => {
    const command = String(body.command ?? '').trim();
    let cwd = String(body.cwd ?? daemonCwd);
    if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) cwd = daemonCwd;

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'access-control-allow-origin': req.headers.origin && req.headers.origin !== 'null' ? req.headers.origin : '*',
    });
    const send = (o: unknown): void => {
      try {
        res.write(`data: ${JSON.stringify(o)}\n\n`);
      } catch {
        /* client gone */
      }
    };

    if (!command) {
      send({ type: 'exit', code: 0, cwd });
      res.end();
      return;
    }

    const isWin = process.platform === 'win32';
    const child = spawn(isWin ? 'cmd' : 'bash', isWin ? ['/c', command] : ['-lc', command], {
      cwd,
      env: process.env,
    });
    child.stdout.on('data', (d: Buffer) => send({ type: 'out', text: d.toString() }));
    child.stderr.on('data', (d: Buffer) => send({ type: 'err', text: d.toString() }));
    child.on('error', (e) => send({ type: 'err', text: `${e.message}\n` }));
    child.on('close', (code) => {
      send({ type: 'exit', code: code ?? 0, cwd });
      res.end();
    });
    req.on('close', () => {
      if (!child.killed) child.kill();
    });
  });
}

function openSse(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'access-control-allow-origin': req.headers.origin && req.headers.origin !== 'null' ? req.headers.origin : '*',
  });
  res.write('retry: 2000\n\n');
  res.write(`data: ${JSON.stringify({ type: 'hello', at: Date.now() })}\n\n`);
  sseClients.add(res);
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(ping);
    }
  }, 25_000);
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
}

const VALID_PRESETS = new Set<LoopPreset>(['safe', 'aggressive', 'ci-repair', 'migration']);

async function handleLoops(
  req: IncomingMessage,
  res: ServerResponse,
  daemonCwd: string,
  method: string,
  path: string,
  url: URL,
): Promise<boolean> {
  const sup = getSupervisor();

  // GET /api/loops?cwd= -> loops for a project, or all when cwd omitted.
  if (path === '/api/loops' && method === 'GET') {
    const project = url.searchParams.get('cwd');
    if (project) sendJson(res, 200, { loops: await sup.list(project) });
    else sendJson(res, 200, await buildAllLoops(daemonCwd));
    return true;
  }

  // GET /api/loops/presets -> preset catalog for the UI.
  if (path === '/api/loops/presets' && method === 'GET') {
    sendJson(res, 200, {
      presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, description: p.description, limits: p.limits })),
    });
    return true;
  }

  // GET /api/loops/discover?cwd= -> detected verifier commands.
  if (path === '/api/loops/discover' && method === 'GET') {
    const project = url.searchParams.get('cwd') ?? daemonCwd;
    sendJson(res, 200, await discoverVerifiers(project));
    return true;
  }

  // All remaining loop routes mutate -> require an allowed origin.
  const body = method === 'GET' ? {} : await readJson(req);
  if (method !== 'GET' && !allowedOrigin(req)) {
    sendJson(res, 403, { error: 'cross-origin request rejected' });
    return true;
  }

  // POST /api/loops/generate -> generate + validate without persisting.
  if (path === '/api/loops/generate' && method === 'POST') {
    const project = String(body.cwd ?? daemonCwd);
    const request = String(body.request ?? '').trim();
    if (!request) return reply(res, 400, { error: 'request required' });
    const preset = pickPreset(body.preset);
    const { registry, router } = await buildExecutionEnv(project);
    const result = await generateLoopSpec(request, { registry, router, cwd: project }, {
      preset,
      verifierCommands: Array.isArray(body.verifierCommands) ? (body.verifierCommands as string[]) : undefined,
    });
    return reply(res, 200, {
      spec: result.spec,
      discovered: result.discovered,
      generated: result.generated,
      validation: validateLoopSpec(result.spec),
    });
  }

  // POST /api/loops -> create (generate + persist as draft).
  if (path === '/api/loops' && method === 'POST') {
    const project = String(body.cwd ?? daemonCwd);
    const request = String(body.request ?? '').trim();
    if (!request) return reply(res, 400, { error: 'request required' });
    const created = await sup.create(project, request, { preset: pickPreset(body.preset) });
    return reply(res, 200, created);
  }

  // POST /api/loops/from-spec -> persist an explicit/edited spec as draft.
  if (path === '/api/loops/from-spec' && method === 'POST') {
    const project = String(body.cwd ?? daemonCwd);
    const spec = body.spec as LoopSpec | undefined;
    if (!spec) return reply(res, 400, { error: 'spec required' });
    return reply(res, 200, await sup.createFromSpec(project, spec));
  }

  // /api/loops/:id and /api/loops/:id/:action
  const m = path.match(/^\/api\/loops\/([^/]+)(?:\/([^/]+))?$/);
  if (!m) return false;
  const loopId = m[1]!;
  const action = m[2];
  const project = String(body.cwd ?? url.searchParams.get('cwd') ?? daemonCwd);

  if (!action && method === 'GET') {
    const rec = await sup.get(project, loopId);
    return reply(res, rec ? 200 : 404, rec ?? { error: 'not found' });
  }
  if (!action && method === 'DELETE') {
    await sup.deleteLoop(project, loopId);
    return reply(res, 200, { ok: true });
  }
  if (action === 'iterations' && method === 'GET') {
    return reply(res, 200, { iterations: await sup.iterations(project, loopId) });
  }
  if (action === 'spec' && method === 'PUT') {
    const spec = body.spec as LoopSpec | undefined;
    if (!spec) return reply(res, 400, { error: 'spec required' });
    const rec = await sup.updateSpec(loopId, project, spec);
    return reply(res, rec ? 200 : 404, rec ?? { error: 'not found' });
  }
  if (method === 'POST') {
    switch (action) {
      case 'start':
        await assertWithinSpendingLimit(project);
        await sup.start(project, loopId).catch((e) => {
          throw e;
        });
        return reply(res, 200, { ok: true });
      case 'pause':
        sup.pause(loopId);
        return reply(res, 200, { ok: true });
      case 'resume':
        await assertWithinSpendingLimit(project);
        await sup.resume(project, loopId);
        return reply(res, 200, { ok: true });
      case 'stop':
        sup.stop(loopId);
        return reply(res, 200, { ok: true });
      case 'approve':
        return reply(res, 200, await sup.approve(project, loopId));
      case 'reject':
        await sup.reject(project, loopId);
        return reply(res, 200, { ok: true });
      default:
        return false;
    }
  }
  return false;
}

function pickPreset(v: unknown): LoopPreset {
  return typeof v === 'string' && VALID_PRESETS.has(v as LoopPreset) ? (v as LoopPreset) : 'safe';
}

function reply(res: ServerResponse, status: number, body: unknown): true {
  sendJson(res, status, body);
  return true;
}
