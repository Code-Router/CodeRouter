import { execFileSync } from 'node:child_process';
import { type Dirent, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const MAX_FILES = 5000;

/**
 * Directories we never want in the `@`-mention picker when we fall back
 * to a manual walk (the `git ls-files` path already respects
 * .gitignore so it doesn't need this list).
 */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  '.turbo',
  '.cache',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.coderouter',
]);

/**
 * Build a list of workspace-relative file paths for the `@`-mention
 * picker. Prefers `git ls-files` (tracked + untracked-but-not-ignored)
 * so the list matches what an editor would show and honours .gitignore
 * for free. Falls back to a bounded manual walk when the directory
 * isn't a git repo or git isn't on PATH.
 */
export function listWorkspaceFiles(cwd: string): string[] {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const files = dedupe(out.split('\n').map((s) => s.trim()).filter(Boolean));
    if (files.length > 0) return files.slice(0, MAX_FILES);
  } catch {
    // not a git repo / git missing - fall through to manual walk
  }
  return walk(cwd);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function walk(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < MAX_FILES) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) break;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(join(dir, e.name));
      } else if (e.isFile()) {
        out.push(relative(root, join(dir, e.name)).split(sep).join('/'));
      }
    }
  }
  return out.sort();
}

/**
 * The active `@`-mention being typed: the `@` must sit at the start of
 * the input or be preceded by whitespace, with no whitespace between it
 * and the cursor. Returns the query text (everything after `@`) and the
 * index of the `@` so the caller can splice in the completion. Returns
 * null when the cursor isn't inside a mention.
 */
export function activeMention(input: string, cursor: number): { query: string; start: number } | null {
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = input[i]!;
    if (ch === '@') {
      const prev = i > 0 ? input[i - 1]! : '';
      if (i === 0 || /\s/.test(prev)) {
        return { query: input.slice(i + 1, cursor), start: i };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

/**
 * Rank workspace files against a mention query. Empty query returns the
 * shortest paths as a sensible starting list. Otherwise ranks basename
 * prefix matches first, then basename substring, then full-path
 * substring; ties broken by path length then alphabetically.
 */
export function rankFiles(files: string[], query: string, limit = 8): string[] {
  const q = query.toLowerCase();
  if (!q) {
    return files.slice().sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, limit);
  }
  const scored: { f: string; s: number }[] = [];
  for (const f of files) {
    const lf = f.toLowerCase();
    const base = lf.slice(lf.lastIndexOf('/') + 1);
    let s = -1;
    if (base.startsWith(q)) s = 0;
    else if (base.includes(q)) s = 1;
    else if (lf.includes(q)) s = 2;
    if (s >= 0) scored.push({ f, s });
  }
  scored.sort((a, b) => a.s - b.s || a.f.length - b.f.length || a.f.localeCompare(b.f));
  return scored.slice(0, limit).map((x) => x.f);
}
