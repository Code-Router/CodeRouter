/**
 * Local dashboard HTTP server.
 *
 * Dependency-free (node:http). Binds to loopback only and serves the
 * inlined SPA plus a small JSON API backed by `data.ts`. Mutating
 * endpoints write the global credentials file, so they're guarded with
 * a same-origin check to block drive-by CSRF from a page the user might
 * have open in the same browser.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  removeCredential,
  saveCredential,
  setHostEnabled,
  setPreferredModel,
  setSpendingLimit,
  SEARCH_PROVIDERS,
  SETUP_PROVIDERS,
} from '../ui/setup.js';
import type { HostProvider } from '../ui/hosts.js';
import { INDEX_HTML } from './assets.js';
import { buildSettingsReport, buildUsageReport } from './data.js';

export type DashboardServer = {
  server: Server;
  url: string;
  port: number;
  close: () => Promise<void>;
};

export type StartOptions = {
  cwd: string;
  /** Preferred port; falls through to the next free port on conflict. */
  port?: number;
  host?: string;
};

const PORT_ATTEMPTS = 12;

export async function startDashboardServer(opts: StartOptions): Promise<DashboardServer> {
  const host = opts.host ?? '127.0.0.1';
  const server = createServer((req, res) => {
    handle(req, res, opts.cwd).catch((err) => {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  const port = await listen(server, host, opts.port ?? 4319);
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
  return {
    server,
    url,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Try preferred port, then increment until one is free. */
function listen(server: Server, host: string, preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (p: number): void => {
      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && attempt < PORT_ATTEMPTS) {
          attempt += 1;
          tryPort(p + 1);
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
      server.listen(p, host);
    };
    tryPort(preferred);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, cwd: string): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (method === 'GET' && (path === '/' || path === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(INDEX_HTML);
    return;
  }

  if (method === 'GET' && path === '/api/usage') {
    sendJson(res, 200, await buildUsageReport(cwd));
    return;
  }

  if (method === 'GET' && path === '/api/settings') {
    sendJson(res, 200, buildSettingsReport(cwd));
    return;
  }

  // Everything below mutates global state — require same-origin.
  if (path.startsWith('/api/settings/')) {
    if (!sameOrigin(req)) {
      sendJson(res, 403, { error: 'cross-origin request rejected' });
      return;
    }
    const body = await readJson(req);

    if (path === '/api/settings/key' && method === 'POST') {
      const provider = findCredentialProvider(body.name);
      if (!provider) return sendJson(res, 400, { error: `unknown provider: ${body.name}` });
      if (typeof body.apiKey !== 'string' || !body.apiKey.trim())
        return sendJson(res, 400, { error: 'apiKey required' });
      saveCredential(provider, body.apiKey);
      return sendJson(res, 200, { ok: true });
    }

    if (path === '/api/settings/key' && method === 'DELETE') {
      const provider = findCredentialProvider(body.name);
      if (!provider) return sendJson(res, 400, { error: `unknown provider: ${body.name}` });
      const out = removeCredential(provider);
      return sendJson(res, 200, { ok: true, ...out });
    }

    if (path === '/api/settings/host' && method === 'POST') {
      const valid: HostProvider[] = ['codex', 'claude_code', 'ollama'];
      if (typeof body.provider !== 'string' || !valid.includes(body.provider as HostProvider))
        return sendJson(res, 400, { error: `unknown host: ${String(body.provider)}` });
      setHostEnabled(body.provider as HostProvider, Boolean(body.enabled));
      return sendJson(res, 200, { ok: true });
    }

    if (path === '/api/settings/limit' && method === 'POST') {
      const raw = body.monthlyUsd;
      if (raw !== null && raw !== undefined && typeof raw !== 'number')
        return sendJson(res, 400, { error: 'monthlyUsd must be a number or null' });
      const limit = typeof raw === 'number' && raw > 0 ? raw : null;
      setSpendingLimit(limit);
      return sendJson(res, 200, { ok: true, monthlyUsd: limit });
    }

    if (path === '/api/settings/preferred-model' && method === 'POST') {
      if (body.tier !== 'strong' && body.tier !== 'cheap')
        return sendJson(res, 400, { error: "tier must be 'strong' or 'cheap'" });
      // Empty / null provider+model clears the preference for that tier.
      if (!body.provider || !body.model) {
        setPreferredModel(body.tier, null);
        return sendJson(res, 200, { ok: true, cleared: true });
      }
      if (typeof body.provider !== 'string' || typeof body.model !== 'string')
        return sendJson(res, 400, { error: 'provider and model must be strings' });
      setPreferredModel(body.tier, { provider: body.provider, model: body.model });
      return sendJson(res, 200, { ok: true });
    }
  }

  sendJson(res, 404, { error: 'not found' });
}

/** Look up a provider by name across cloud + web-search credential lists. */
function findCredentialProvider(name: unknown) {
  return [...SETUP_PROVIDERS, ...SEARCH_PROVIDERS].find((p) => p.name === name);
}

/**
 * Accept requests with no Origin (curl, same-tab fetch in some browsers)
 * or an Origin whose host is loopback. Rejects a foreign site POSTing to
 * our port behind the user's back.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}
