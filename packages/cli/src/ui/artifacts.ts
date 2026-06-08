import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * Apply a recorded patch back to the host repo using `git apply`.
 * Returns a structured outcome the REPL can render. Tries a plain
 * apply first, then a `--3way` retry to ride out small context
 * drift (the user may have edited files between the run and the
 * accept). On hard failure we keep the artifact on disk so the user
 * can inspect / fix it manually.
 */
export function applyArtifact(
  repo: string,
  artifact: RecordedRun,
): { ok: true; strategy: 'apply' | '3way' } | { ok: false; error: string } {
  if (!existsSync(artifact.patchPath)) {
    return { ok: false, error: `patch missing: ${artifact.patchPath}` };
  }
  try {
    execFileSync('git', ['apply', '--index', artifact.patchPath], {
      cwd: repo,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, strategy: 'apply' };
  } catch {
    // first attempt failed — try a 3-way merge for context drift
  }
  try {
    execFileSync('git', ['apply', '--3way', '--index', artifact.patchPath], {
      cwd: repo,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, strategy: '3way' };
  } catch (err) {
    const msg = (err as { stderr?: Buffer; message?: string }).stderr?.toString().trim()
      || (err as Error).message;
    return { ok: false, error: msg };
  }
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
