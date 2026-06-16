import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Per-file diff stats. The REPL renders these as
 *   <path>   +<insertions>  -<deletions>
 * with green and red colors so the user can scan a multi-file
 * change at a glance without paging through the raw patch.
 */
export type FileStats = {
  file: string;
  insertions: number;
  deletions: number;
  binary?: boolean;
  /**
   * True when the patch removes the file entirely (`deleted file mode
   * 100644` header). The REPL uses this to decide whether to auto-apply
   * the artifact or pause for explicit approval - users want
   * non-destructive changes to land without ceremony, but always want
   * to see a confirm prompt before a file is removed from disk.
   */
  deleted?: boolean;
};

/**
 * Snapshot of one persisted run artifact under
 * `<repo>/.coderouter/runs/<runId>/`. Created by the agent mode
 * before the worktree is destroyed; consumed by the REPL when the
 * user wants to accept (apply), reject (delete), or inspect a
 * previous run's diff.
 */
export type RecordedRun = {
  runId: string;
  dir: string;
  patchPath: string;
  manifestPath: string;
  files: string[];
  /** Unix ms when the run completed. Falls back to dir mtime. */
  completedAt: number;
  /** Cached patch content. Empty string if the patch is missing. */
  patch: string;
  /** Quick stats (insertions/deletions/files) parsed from the patch. */
  stats: { files: number; insertions: number; deletions: number };
  /** Per-file insertion/deletion counts, in patch order. */
  fileStats: FileStats[];
};

const RUNS_SUBDIR = ['.coderouter', 'runs'];

function runsDir(repo: string): string {
  return join(repo, ...RUNS_SUBDIR);
}

/**
 * Load every persisted run artifact under `<repo>/.coderouter/runs/`
 * sorted newest first. Skips directories that don't have a
 * `changes.patch` (incomplete writes).
 */
export function listArtifacts(repo: string): RecordedRun[] {
  const root = runsDir(repo);
  if (!existsSync(root)) return [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: RecordedRun[] = [];
  for (const name of entries) {
    const dir = join(root, name);
    let dirStat;
    try {
      dirStat = statSync(dir);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;
    const patchPath = join(dir, 'changes.patch');
    const manifestPath = join(dir, 'manifest.json');
    if (!existsSync(patchPath)) continue;
    let patch = '';
    try {
      patch = readFileSync(patchPath, 'utf8');
    } catch {
      patch = '';
    }
    let manifest: { files?: string[]; completedAt?: number } = {};
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest;
    } catch {
      // missing or malformed manifest is non-fatal
    }
    const fileStats = parsePerFileStats(patch);
    out.push({
      runId: name,
      dir,
      patchPath,
      manifestPath,
      files: manifest.files ?? fileStats.map((s) => s.file),
      completedAt: manifest.completedAt ?? dirStat.mtimeMs,
      patch,
      stats: aggregateStats(fileStats),
      fileStats,
    });
  }
  out.sort((a, b) => b.completedAt - a.completedAt);
  return out;
}

/**
 * Look up a single artifact by run id (or partial prefix). Returns
 * null when nothing matches; ambiguous prefixes resolve to the
 * newest match.
 */
export function findArtifact(repo: string, idOrPrefix: string): RecordedRun | null {
  const all = listArtifacts(repo);
  const exact = all.find((a) => a.runId === idOrPrefix);
  if (exact) return exact;
  const prefix = all.find((a) => a.runId.startsWith(idOrPrefix));
  return prefix ?? null;
}

/**
 * Load an artifact directly from its directory (the path the agent
 * mode returns on each run). Cheaper than `listArtifacts` because
 * we skip scanning every sibling run.
 */
export function loadArtifact(dir: string): RecordedRun | null {
  if (!existsSync(dir)) return null;
  let dirStat;
  try {
    dirStat = statSync(dir);
  } catch {
    return null;
  }
  if (!dirStat.isDirectory()) return null;
  const patchPath = join(dir, 'changes.patch');
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(patchPath)) return null;
  let patch = '';
  try {
    patch = readFileSync(patchPath, 'utf8');
  } catch {
    patch = '';
  }
  let manifest: { files?: string[]; completedAt?: number } = {};
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest;
  } catch {
    // missing or malformed manifest is non-fatal
  }
  const runId = dir.split('/').pop() ?? dir;
  const fileStats = parsePerFileStats(patch);
  return {
    runId,
    dir,
    patchPath,
    manifestPath,
    files: manifest.files ?? fileStats.map((s) => s.file),
    completedAt: manifest.completedAt ?? dirStat.mtimeMs,
    patch,
    stats: aggregateStats(fileStats),
    fileStats,
  };
}

type ApplyResult =
  | { ok: true; strategy: 'apply' | '3way'; overwrote?: string[] }
  | { ok: false; error: string };

/** Run `git apply <args>` in `repo`, capturing stderr on failure. */
function gitApply(repo: string, args: string[]): { ok: true } | { ok: false; stderr: string } {
  try {
    execFileSync('git', ['apply', ...args], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (err) {
    const stderr =
      (err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message ?? '';
    return { ok: false, stderr };
  }
}

/**
 * Paths git refuses to apply because a "new file" patch targets a file
 * that already exists on disk. git emits one
 * `error: <path>: already exists in working directory` line per
 * collision; we parse them so the caller can resolve the conflict.
 */
function parseAlreadyExists(stderr: string): string[] {
  const out: string[] = [];
  for (const raw of stderr.split('\n')) {
    const m = /^error:\s+(.+?):\s+already exists in working directory\s*$/.exec(raw.trim());
    if (m?.[1]) out.push(m[1]);
  }
  return [...new Set(out)];
}

/**
 * Apply a recorded patch back to the host repo using `git apply`.
 * Returns a structured outcome the REPL can render.
 *
 * Order of attempts:
 *   1. Plain working-tree apply (NOT `--index` - auto-inited repos
 *      leave files untracked, and `--index` hard-fails on any patch
 *      touching an untracked file).
 *   2. `--3way` to ride out small context drift on tracked files (the
 *      user may have edited them between the run and the accept).
 *   3. New-file collision recovery: when the patch *creates* a file
 *      that already exists on disk (commonly an untracked artifact the
 *      agent just regenerated, e.g. a freshly written test file), git
 *      can't apply over it and `--3way` can't help (an untracked file
 *      has no index blob to merge against). We back the existing file
 *      up into the run dir, remove it, and re-apply so the agent's
 *      authored content lands. Backups mean nothing is silently lost.
 *
 * On hard failure we keep the artifact on disk so the user can inspect
 * / fix it manually.
 */
export function applyArtifact(repo: string, artifact: RecordedRun): ApplyResult {
  if (!existsSync(artifact.patchPath)) {
    return { ok: false, error: `patch missing: ${artifact.patchPath}` };
  }

  const plain = gitApply(repo, [artifact.patchPath]);
  if (plain.ok) return { ok: true, strategy: 'apply' };

  // Non-destructive 3-way merge first (handles context drift).
  const threeway = gitApply(repo, ['--3way', artifact.patchPath]);
  if (threeway.ok) return { ok: true, strategy: '3way' };

  // New-file collisions: only the *plain* attempt reports these
  // ("already exists in working directory"). Resolve by backing up +
  // removing the colliding files, then re-applying.
  const collisions = parseAlreadyExists(plain.stderr);
  if (collisions.length > 0) {
    const backupDir = join(artifact.dir, 'overwritten');
    const overwrote: string[] = [];
    for (const rel of collisions) {
      const abs = join(repo, rel);
      if (!existsSync(abs)) continue;
      try {
        const dest = join(backupDir, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(abs, dest);
        rmSync(abs, { force: true });
        overwrote.push(rel);
      } catch {
        // If we can't back up / remove, leave the file and let the
        // retry fail so we don't lose data silently.
      }
    }
    if (overwrote.length > 0) {
      const retry = gitApply(repo, [artifact.patchPath]);
      if (retry.ok) return { ok: true, strategy: 'apply', overwrote };
    }
  }

  return { ok: false, error: threeway.stderr.trim() || plain.stderr.trim() };
}

/**
 * Discard a recorded artifact directory entirely. Used by the
 * "reject" path when the user wants the patch gone, not just left
 * sitting on disk.
 */
export function discardArtifact(artifact: RecordedRun): void {
  rmSync(artifact.dir, { recursive: true, force: true });
}

/**
 * Walk a unified diff and produce per-file insertion / deletion
 * counts. Tolerant of:
 *   - new files (no `a/` side, just `b/`)
 *   - deletes (no `b/` side; we attribute counts to `a/`)
 *   - renames / mode changes (`similarity index`, `rename from/to`)
 *   - binary patches (we mark the file with `binary: true` and
 *     leave the counts at 0)
 */
function parsePerFileStats(patch: string): FileStats[] {
  if (!patch) return [];
  const out: FileStats[] = [];
  let current: FileStats | null = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) out.push(current);
      const match = /diff --git a\/(.+) b\/(.+)$/.exec(line);
      const file = match?.[2] ?? match?.[1] ?? 'unknown';
      current = { file, insertions: 0, deletions: 0 };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('Binary files')) {
      current.binary = true;
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      current.deleted = true;
      continue;
    }
    // Skip header lines so they don't get counted as +/-
    if (
      line.startsWith('+++') ||
      line.startsWith('---') ||
      line.startsWith('@@') ||
      line.startsWith('index ') ||
      line.startsWith('new file mode') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to')
    ) {
      continue;
    }
    if (line.startsWith('+')) current.insertions += 1;
    else if (line.startsWith('-')) current.deletions += 1;
  }
  if (current) out.push(current);
  return out;
}

function aggregateStats(perFile: FileStats[]): {
  files: number;
  insertions: number;
  deletions: number;
} {
  let insertions = 0;
  let deletions = 0;
  for (const f of perFile) {
    insertions += f.insertions;
    deletions += f.deletions;
  }
  return { files: perFile.length, insertions, deletions };
}
