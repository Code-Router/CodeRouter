import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandError, exec, git, gitOrThrow } from './exec.js';

export type WorktreeOptions = {
  /** Absolute path of the source repo. */
  repoPath: string;
  /** Base ref to fork from. Defaults to HEAD. */
  baseRef?: string;
  /** Optional prefix for the worktree directory. */
  prefix?: string;
  /** Optional explicit branch name. Defaults to `cr/<runId>`. */
  branch?: string;
  /** Optional runId used for branch/dir naming. Defaults to a random uuid. */
  runId?: string;
  /** Where to put the worktree. Defaults to a tmpdir. */
  parentDir?: string;
};

export type Worktree = {
  runId: string;
  branch: string;
  path: string;
  baseRef: string;
  baseSha: string;
  repoPath: string;
  createdAt: number;
};

export type WorktreeMetrics = {
  filesChanged: number;
  insertions: number;
  deletions: number;
};

/**
 * Creates a fresh git worktree forked from `baseRef` of `repoPath`. The
 * worktree lives in a tmpdir by default; the caller owns its lifecycle and
 * must call `destroyWorktree` (or `mergeWorktree`) when done.
 *
 * This is the foundation of CodeRouter's run-isolation contract: every
 * agent invocation operates inside its own worktree, so we can read the
 * diff, decide whether to keep it, and abandon failed runs without
 * polluting the user's working copy.
 */
export async function createWorktree(opts: WorktreeOptions): Promise<Worktree> {
  const repoPath = opts.repoPath;

  // Validate the source path is a git repo.
  const insideCheck = await git(['rev-parse', '--is-inside-work-tree'], {
    cwd: repoPath,
  });
  if (insideCheck.exitCode !== 0 || insideCheck.stdout.trim() !== 'true') {
    throw new Error(`createWorktree: ${repoPath} is not a git working tree`);
  }

  const runId = opts.runId ?? randomUUID().slice(0, 8);
  const branch = opts.branch ?? `cr/${runId}`;

  const baseRef = opts.baseRef ?? 'HEAD';
  const baseShaRes = await gitOrThrow(['rev-parse', baseRef], { cwd: repoPath });
  const baseSha = baseShaRes.stdout.trim();

  // Always place worktrees in a tmpdir under our prefix; this keeps them
  // outside the repo (avoiding stray nested .git folders) and easy to GC.
  const parent = opts.parentDir ?? (await mkdtemp(join(tmpdir(), 'coderouter-')));
  await mkdir(parent, { recursive: true });
  const wtPath = join(parent, `${opts.prefix ?? 'wt'}-${runId}`);

  // `git worktree add -b <branch> <path> <baseSha>` creates a new branch
  // forked at baseSha and checks it out into the worktree path.
  await gitOrThrow(['worktree', 'add', '-b', branch, wtPath, baseSha], {
    cwd: repoPath,
  });

  return {
    runId,
    branch,
    path: wtPath,
    baseRef,
    baseSha,
    repoPath,
    createdAt: Date.now(),
  };
}

/**
 * Reads the worktree's current diff against its base sha. Includes
 * untracked files (which `git diff` omits by default) by staging them
 * with `git add -N` so they appear as adds.
 */
export async function diffWorktree(wt: Worktree): Promise<string> {
  // Force untracked files to appear in the diff.
  await git(['add', '-N', '.'], { cwd: wt.path });

  const result = await git(['diff', '--patch', wt.baseSha], { cwd: wt.path });
  if (result.exitCode !== 0) {
    throw new CommandError(
      `git diff failed: ${result.stderr.trim()}`,
      result,
      'git',
      ['diff', wt.baseSha],
    );
  }
  return result.stdout;
}

/** Returns the list of files that differ from baseSha (added/modified/deleted). */
export async function changedFiles(wt: Worktree): Promise<string[]> {
  await git(['add', '-N', '.'], { cwd: wt.path });
  const result = await gitOrThrow(
    ['diff', '--name-only', wt.baseSha],
    { cwd: wt.path },
  );
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Returns short metrics for the worktree diff (used by report layer). */
export async function diffStats(wt: Worktree): Promise<WorktreeMetrics> {
  await git(['add', '-N', '.'], { cwd: wt.path });
  const result = await git(['diff', '--numstat', wt.baseSha], { cwd: wt.path });
  if (result.exitCode !== 0) {
    return { filesChanged: 0, insertions: 0, deletions: 0 };
  }
  let insertions = 0;
  let deletions = 0;
  let filesChanged = 0;
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [insStr, delStr] = line.split('\t');
    const ins = Number.parseInt(insStr ?? '', 10);
    const del = Number.parseInt(delStr ?? '', 10);
    if (!Number.isNaN(ins)) insertions += ins;
    if (!Number.isNaN(del)) deletions += del;
    filesChanged += 1;
  }
  return { filesChanged, insertions, deletions };
}

/**
 * Merges the worktree's changes back into the host repo. Uses a patch +
 * `git apply` strategy so we don't need to fast-forward branches or mess
 * with the user's checked-out branch state. Returns the list of files
 * touched on the host side.
 */
export async function mergeWorktree(
  wt: Worktree,
  opts: { strategy?: 'apply' | 'cherry-pick'; cleanup?: boolean } = {},
): Promise<string[]> {
  const strategy = opts.strategy ?? 'apply';
  const files = await changedFiles(wt);
  if (files.length === 0) {
    if (opts.cleanup !== false) await destroyWorktree(wt);
    return [];
  }

  if (strategy === 'apply') {
    const patch = await diffWorktree(wt);
    const apply = await exec('git', ['apply', '--index', '-'], {
      cwd: wt.repoPath,
      input: patch,
    });
    if (apply.exitCode !== 0) {
      // Fall back to a 3-way apply for context drift.
      const apply3 = await exec(
        'git',
        ['apply', '--3way', '--index', '-'],
        { cwd: wt.repoPath, input: patch },
      );
      if (apply3.exitCode !== 0) {
        throw new CommandError(
          `mergeWorktree: git apply failed: ${apply3.stderr.trim() || apply.stderr.trim()}`,
          apply3,
          'git',
          ['apply'],
        );
      }
    }
  } else {
    // cherry-pick path; rarely used because we don't commit inside the
    // worktree by default.
    await gitOrThrow(['cherry-pick', wt.branch], { cwd: wt.repoPath });
  }

  if (opts.cleanup !== false) await destroyWorktree(wt);
  return files;
}

/**
 * Discards the worktree and its branch. Safe to call multiple times; each
 * step swallows missing-target errors so cleanup never fails the run.
 */
export async function destroyWorktree(wt: Worktree): Promise<void> {
  // git worktree remove + branch delete; both best-effort.
  await git(['worktree', 'remove', '--force', wt.path], { cwd: wt.repoPath });
  await git(['branch', '-D', wt.branch], { cwd: wt.repoPath });
  await rm(wt.path, { recursive: true, force: true });
}

/**
 * Lists all worktrees the user has registered for this repo. Used by the
 * `coderouter log` / GC paths to clean up orphans.
 */
export async function listWorktrees(
  repoPath: string,
): Promise<{ path: string; branch: string; sha: string }[]> {
  const result = await git(['worktree', 'list', '--porcelain'], { cwd: repoPath });
  if (result.exitCode !== 0) return [];
  const out: { path: string; branch: string; sha: string }[] = [];
  let current: Partial<{ path: string; branch: string; sha: string }> = {};
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) {
        out.push({
          path: current.path,
          branch: current.branch ?? '',
          sha: current.sha ?? '',
        });
      }
      current = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace('refs/heads/', '');
    } else if (line.startsWith('HEAD ')) {
      current.sha = line.slice('HEAD '.length);
    }
  }
  if (current.path) {
    out.push({
      path: current.path,
      branch: current.branch ?? '',
      sha: current.sha ?? '',
    });
  }
  return out;
}

/**
 * One-shot helper: create a worktree, hand it to `fn`, and clean up
 * regardless of outcome. Useful for tournament/handoff workflows that
 * always discard their worktrees after extracting a diff.
 */
export async function withWorktree<T>(
  opts: WorktreeOptions,
  fn: (wt: Worktree) => Promise<T>,
): Promise<T> {
  const wt = await createWorktree(opts);
  try {
    return await fn(wt);
  } finally {
    await destroyWorktree(wt).catch(() => {
      // best-effort cleanup
    });
  }
}
