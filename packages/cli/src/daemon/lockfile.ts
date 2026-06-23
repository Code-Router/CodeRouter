import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { coderouterHome } from '@coderouter/core';
import { CLI_VERSION } from '../version.js';

/**
 * Daemon singleton bookkeeping. The daemon writes `~/.coderouter/daemon.json`
 * with its port + pid on startup; clients (the Electron app, `coderouter
 * loop`) read it to connect, and spawn a fresh daemon if none is alive.
 */

export type DaemonInfo = {
  port: number;
  pid: number;
  startedAt: number;
  version: string;
};

export const DEFAULT_DAEMON_PORT = 4329;

function infoPath(): string {
  return join(coderouterHome(), 'daemon.json');
}

export function readDaemonInfo(): DaemonInfo | null {
  try {
    return JSON.parse(readFileSync(infoPath(), 'utf8')) as DaemonInfo;
  } catch {
    return null;
  }
}

export function writeDaemonInfo(info: DaemonInfo): void {
  mkdirSync(coderouterHome(), { recursive: true });
  writeFileSync(infoPath(), `${JSON.stringify(info, null, 2)}\n`, 'utf8');
}

export function clearDaemonInfo(): void {
  try {
    rmSync(infoPath(), { force: true });
  } catch {
    // ignore
  }
}

/** True when a daemon answers /api/health on `port`. */
export async function pingDaemon(port: number, timeoutMs = 1500): Promise<DaemonInfo | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as DaemonInfo;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Stop a running daemon by PID and wait for it to release its port. Used to
 * replace a stale daemon left running by an older install (the daemon is
 * detached and survives a `git pull`/reinstall, so without this a user can be
 * stuck on the old version indefinitely).
 */
export async function stopDaemon(info: DaemonInfo, waitMs = 5000): Promise<void> {
  try {
    process.kill(info.pid, 'SIGTERM');
  } catch {
    // already gone
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!(await pingDaemon(info.port, 800))) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (await pingDaemon(info.port, 800)) {
    try {
      process.kill(info.pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }
  clearDaemonInfo();
}

/**
 * Return a live daemon's info, spawning one (detached) if needed. The
 * spawned process keeps running after this CLI exits so loops survive.
 *
 * If a daemon is alive but runs a different version than this CLI (e.g. left
 * over from an older clone/install), it is stopped and replaced so users
 * always run the version they just installed.
 */
export async function ensureDaemon(opts: { cwd: string } = { cwd: process.cwd() }): Promise<DaemonInfo> {
  const existing = readDaemonInfo();
  if (existing) {
    const alive = await pingDaemon(existing.port);
    if (alive) {
      if (alive.version === CLI_VERSION) return alive;
      await stopDaemon(alive);
    } else {
      clearDaemonInfo();
    }
  }

  // Spawn `coderouter daemon` detached. argv[1] is this CLI's entry.
  const entry = process.argv[1] ?? 'coderouter';
  const child = spawn(process.execPath, [entry, 'daemon', '--cwd', opts.cwd], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Poll for the daemon to come up.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    const info = readDaemonInfo();
    if (info) {
      const alive = await pingDaemon(info.port);
      if (alive) return alive;
    }
  }
  throw new Error('daemon failed to start within 15s');
}
