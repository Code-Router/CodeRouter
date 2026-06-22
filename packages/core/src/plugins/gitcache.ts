import { execFile } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** CodeRouter's home dir (overridable for tests via CODEROUTER_HOME). */
export function coderouterHome(): string {
  return process.env.CODEROUTER_HOME || join(homedir(), '.coderouter');
}

function cacheRoot(): string {
  return join(coderouterHome(), 'plugins-cache');
}

/** Normalize `owner/repo`, `gh:owner/repo`, or a git URL into a clone URL. */
export function toCloneUrl(repo: string): string {
  const s = repo.trim().replace(/^gh:/i, '');
  // Local filesystem paths (used in tests / local marketplaces) clone as-is.
  if (s.startsWith('/') || s.startsWith('.') || /^file:/i.test(s)) return s;
  if (/^https?:\/\//i.test(s) || /^git@/i.test(s)) {
    return s.endsWith('.git') || /^https?:\/\//i.test(s) ? s : `${s}.git`;
  }
  if (s.endsWith('.git')) return s;
  return `https://github.com/${s}.git`;
}

function slugForUrl(url: string): string {
  const base = url
    .replace(/^https?:\/\//i, '')
    .replace(/\.git$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  return `${base.slice(0, 60)}-${(h >>> 0).toString(36)}`;
}

const exists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * Ensure a blobless, no-checkout shallow clone of `repo` exists in the
 * cache and return its path. We never check out a working tree; callers
 * read files with `lsTree`/`showFile`, so only the objects actually
 * needed are fetched (cheap even for huge marketplace repos).
 */
export async function ensureRepo(
  repo: string,
  opts: { ref?: string; refresh?: boolean } = {},
): Promise<string> {
  const url = toCloneUrl(repo);
  const dir = join(cacheRoot(), slugForUrl(url));
  if (opts.refresh && (await exists(dir))) await rm(dir, { recursive: true, force: true });
  if (await exists(join(dir, '.git'))) return dir;

  await mkdir(cacheRoot(), { recursive: true });
  await rm(dir, { recursive: true, force: true });
  const args = ['clone', '--filter=blob:none', '--no-checkout', '--depth', '1'];
  // Branches/tags can be cloned directly; raw SHAs cannot via --branch.
  if (opts.ref && !SHA_RE.test(opts.ref)) args.push('--branch', opts.ref);
  args.push(url, dir);
  await exec('git', args, { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  return dir;
}

/** List file paths at HEAD under an optional prefix. */
export async function lsTree(dir: string, prefix = ''): Promise<string[]> {
  const args = ['-C', dir, 'ls-tree', '-r', '--name-only', 'HEAD'];
  if (prefix) args.push('--', prefix.replace(/\/+$/, ''));
  try {
    const { stdout } = await exec('git', args, { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Read a file's contents at HEAD (fetches the one blob on demand). */
export async function showFile(dir: string, path: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['-C', dir, 'show', `HEAD:${path}`], {
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

/** Current HEAD sha of a cached repo (best effort). */
export async function headSha(dir: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec('git', ['-C', dir, 'rev-parse', 'HEAD'], { timeout: 15_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
