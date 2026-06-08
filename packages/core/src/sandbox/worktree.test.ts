import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exec, gitOrThrow } from './exec.js';
import {
  changedFiles,
  createWorktree,
  destroyWorktree,
  diffStats,
  diffWorktree,
  listWorktrees,
  mergeWorktree,
  withWorktree,
} from './worktree.js';

let repoPath: string;
let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'cr-test-'));
  repoPath = join(tmpRoot, 'repo');
  await exec('git', ['init', '-q', '-b', 'main', repoPath]);
  await gitOrThrow(['config', 'user.email', 'test@coderouter.dev'], { cwd: repoPath });
  await gitOrThrow(['config', 'user.name', 'CodeRouter Test'], { cwd: repoPath });
  await writeFile(join(repoPath, 'README.md'), '# fixture\n');
  await writeFile(join(repoPath, 'src.ts'), "export const x = 1;\n");
  await gitOrThrow(['add', '-A'], { cwd: repoPath });
  await gitOrThrow(['commit', '-q', '-m', 'init'], { cwd: repoPath });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('worktree', () => {
  it('creates a worktree forked from HEAD', async () => {
    const wt = await createWorktree({ repoPath });
    expect(wt.branch.startsWith('cr/')).toBe(true);
    expect(wt.baseSha).toMatch(/^[0-9a-f]{40}$/);
    const wtReadme = await readFile(join(wt.path, 'README.md'), 'utf8');
    expect(wtReadme).toBe('# fixture\n');
    await destroyWorktree(wt);
  });

  it('captures diffs from edits inside the worktree', async () => {
    const wt = await createWorktree({ repoPath });
    await writeFile(join(wt.path, 'src.ts'), "export const x = 2;\n");
    const patch = await diffWorktree(wt);
    expect(patch).toContain('-export const x = 1;');
    expect(patch).toContain('+export const x = 2;');
    const files = await changedFiles(wt);
    expect(files).toEqual(['src.ts']);
    const stats = await diffStats(wt);
    expect(stats.filesChanged).toBe(1);
    expect(stats.insertions).toBeGreaterThan(0);
    expect(stats.deletions).toBeGreaterThan(0);
    await destroyWorktree(wt);
  });

  it('includes untracked files in the diff', async () => {
    const wt = await createWorktree({ repoPath });
    await writeFile(join(wt.path, 'new.ts'), 'export const y = 3;\n');
    const files = await changedFiles(wt);
    expect(files).toContain('new.ts');
    const patch = await diffWorktree(wt);
    expect(patch).toContain('new.ts');
    await destroyWorktree(wt);
  });

  it('merges changes back into the host repo via apply', async () => {
    const wt = await createWorktree({ repoPath });
    await writeFile(join(wt.path, 'src.ts'), "export const x = 42;\n");
    await writeFile(join(wt.path, 'added.ts'), 'export const z = 7;\n');
    const files = await mergeWorktree(wt);
    expect(files).toEqual(expect.arrayContaining(['src.ts', 'added.ts']));
    const merged = await readFile(join(repoPath, 'src.ts'), 'utf8');
    expect(merged).toBe('export const x = 42;\n');
    const added = await readFile(join(repoPath, 'added.ts'), 'utf8');
    expect(added).toBe('export const z = 7;\n');
  });

  it('destroyWorktree removes the worktree dir and branch', async () => {
    const wt = await createWorktree({ repoPath });
    await destroyWorktree(wt);
    const wts = await listWorktrees(repoPath);
    expect(wts.find((w) => w.path === wt.path)).toBeUndefined();
  });

  it('withWorktree cleans up on success and on throw', async () => {
    const value = await withWorktree({ repoPath }, async (wt) => {
      await writeFile(join(wt.path, 'src.ts'), "export const x = 9;\n");
      return 'ok';
    });
    expect(value).toBe('ok');
    const orig = await readFile(join(repoPath, 'src.ts'), 'utf8');
    expect(orig).toBe('export const x = 1;\n');

    await expect(
      withWorktree({ repoPath }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('rejects non-git paths', async () => {
    const nonGit = join(tmpRoot, 'not-a-repo');
    await exec('mkdir', ['-p', nonGit]);
    await expect(createWorktree({ repoPath: nonGit })).rejects.toThrow(
      /not a git working tree/,
    );
  });

  it('mirrors host pending changes (tracked + untracked) into the worktree', async () => {
    // Stage a tracked edit and create an untracked file in the host
    // repo before forking - simulates the "agent applied a file but
    // didn't commit" pattern that breaks multi-turn REPL sessions.
    await writeFile(join(repoPath, 'src.ts'), "export const x = 99;\n");
    await writeFile(join(repoPath, 'untracked.md'), '# untracked\n');

    const wt = await createWorktree({ repoPath });

    // Worktree should see BOTH the staged tracked edit and the
    // untracked file, exactly as the user's working tree has them.
    const tracked = await readFile(join(wt.path, 'src.ts'), 'utf8');
    expect(tracked).toBe('export const x = 99;\n');
    const untracked = await readFile(join(wt.path, 'untracked.md'), 'utf8');
    expect(untracked).toBe('# untracked\n');

    // baseSha should advance past HEAD - subsequent diffs are
    // computed against the mirror commit, so they capture only the
    // agent's net changes (not the host's pending state, which is
    // already in the host repo).
    const headRes = await gitOrThrow(['rev-parse', 'HEAD'], { cwd: repoPath });
    const repoHead = headRes.stdout.trim();
    expect(wt.baseSha).not.toBe(repoHead);

    // No edits in the worktree after mirroring → empty diff.
    const noopFiles = await changedFiles(wt);
    expect(noopFiles).toEqual([]);

    await destroyWorktree(wt);
  });
});
