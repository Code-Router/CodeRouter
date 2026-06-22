import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LoopEvent, LoopSpec, LoopPreset } from '@coderouter/core';
import { PRESETS, discoverVerifiers, generateLoopSpec, validateLoopSpec } from '@coderouter/core';
import { CLI_VERSION } from '../version.js';
import { handle as handleDashboard, readJson, sendJson } from '../dashboard/server.js';
import { buildExecutionEnv } from '../runtime.js';
import { buildAllLoops, buildChatDetail, buildChatsReport, buildProjectsReport } from './data.js';
import {
  clearDaemonInfo,
  DEFAULT_DAEMON_PORT,
  writeDaemonInfo,
} from './lockfile.js';
import { getSupervisor } from './supervisor.js';

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

  // ---- loops ------------------------------------------------------
  if (path === '/api/loops' || path.startsWith('/api/loops/')) {
    const handled = await handleLoops(req, res, cwd, method, path, url);
    if (handled) return;
  }

  // ---- delegate everything else to the dashboard -----------------
  await handleDashboard(req, res, cwd);
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
        await sup.start(project, loopId).catch((e) => {
          throw e;
        });
        return reply(res, 200, { ok: true });
      case 'pause':
        sup.pause(loopId);
        return reply(res, 200, { ok: true });
      case 'resume':
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
