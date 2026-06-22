import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { coderouterHome } from '../paths.js';
import { resolveDbPath } from './db.js';

/**
 * A repo where CodeRouter has been run. Tracked machine-wide so the
 * dashboard can aggregate usage across every project on this computer
 * rather than just the current one.
 */
export type ProjectEntry = {
  cwd: string;
  dbPath: string;
  lastSeen: number;
};

type Registry = { projects: ProjectEntry[] };

function registryPath(): string {
  return join(coderouterHome(), 'projects.json');
}

function read(): Registry {
  try {
    const parsed = JSON.parse(readFileSync(registryPath(), 'utf8')) as Registry;
    return { projects: Array.isArray(parsed.projects) ? parsed.projects : [] };
  } catch {
    return { projects: [] };
  }
}

function write(reg: Registry): void {
  mkdirSync(coderouterHome(), { recursive: true });
  writeFileSync(registryPath(), `${JSON.stringify(reg, null, 2)}\n`, 'utf8');
}

/**
 * Record (or refresh) a repo in the machine-wide project registry.
 * Deduped by db path. Cheap and synchronous; safe to call on every run.
 */
export function registerProject(repoRoot: string): ProjectEntry {
  const dbPath = resolveDbPath(repoRoot);
  const entry: ProjectEntry = { cwd: repoRoot, dbPath, lastSeen: Date.now() };
  const reg = read();
  const existing = reg.projects.find((p) => p.dbPath === dbPath);
  if (existing) {
    existing.cwd = repoRoot;
    existing.lastSeen = entry.lastSeen;
  } else {
    reg.projects.push(entry);
  }
  try {
    write(reg);
  } catch {
    // best-effort; never let registry bookkeeping break a run
  }
  return entry;
}

/** All registered projects whose db still exists, most-recent first. */
export function listProjects(): ProjectEntry[] {
  return read()
    .projects.filter((p) => existsSync(p.dbPath))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Bulk-register projects in a single write (used by discovery). */
function registerMany(dirs: string[]): void {
  if (dirs.length === 0) return;
  const reg = read();
  const byPath = new Map(reg.projects.map((p) => [p.dbPath, p] as const));
  const now = Date.now();
  for (const cwd of dirs) {
    const dbPath = resolveDbPath(cwd);
    const existing = byPath.get(dbPath);
    if (existing) {
      existing.cwd = cwd;
    } else {
      const entry: ProjectEntry = { cwd, dbPath, lastSeen: now };
      byPath.set(dbPath, entry);
      reg.projects.push(entry);
    }
  }
  try {
    write(reg);
  } catch {
    // best-effort
  }
}

// Directory names never worth descending into during discovery.
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'venv', '.venv',
  '__pycache__', 'Library', 'Applications', 'go', 'Pictures', 'Movies', 'Music',
]);

/**
 * One-time backfill: walk the filesystem (from `roots`, default the home
 * dir) looking for existing `<repo>/.coderouter/memory.db` and register
 * each repo found. Bounded by depth and a wall-clock budget, and skips
 * hidden + heavy directories, so it stays cheap. Returns repos found.
 */
export async function discoverProjects(
  opts: { roots?: string[]; maxDepth?: number; budgetMs?: number } = {},
): Promise<string[]> {
  const roots = opts.roots ?? [homedir()];
  const maxDepth = opts.maxDepth ?? 6;
  const deadline = Date.now() + (opts.budgetMs ?? 6000);
  const found: string[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (Date.now() > deadline || depth > maxDepth) return;
    // A repo is any dir holding `.coderouter/memory.db`.
    if (existsSync(join(dir, '.coderouter', 'memory.db'))) found.push(dir);

    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      // Skip hidden dirs (incl. .git/.coderouter) and known-heavy dirs.
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      await walk(join(dir, e.name), depth + 1);
      if (Date.now() > deadline) return;
    }
  };

  for (const root of roots) await walk(root, 0);
  registerMany(found);
  return found;
}
