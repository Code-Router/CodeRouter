import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../providers/index.js';
import { exec, gitOrThrow } from '../sandbox/exec.js';
import type { LoopRunContext } from './context.js';
import { isBlocked, runLoop } from './runner.js';
import type { LoopSpec } from './types.js';

let repoPath: string;
let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'cr-loop-'));
  repoPath = join(tmpRoot, 'repo');
  await exec('git', ['init', '-q', '-b', 'main', repoPath]);
  await gitOrThrow(['config', 'user.email', 'test@coderouter.dev'], { cwd: repoPath });
  await gitOrThrow(['config', 'user.name', 'CodeRouter Test'], { cwd: repoPath });
  await writeFile(join(repoPath, 'README.md'), '# fixture\n');
  await gitOrThrow(['add', '-A'], { cwd: repoPath });
  await gitOrThrow(['commit', '-q', '-m', 'init'], { cwd: repoPath });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// Empty registry => no ready providers => the edit phase can't resolve a
// route and fails fast, keeping the failure-path test deterministic
// (otherwise a real Claude Code / Codex CLI on PATH would actually run).
function ctx(): LoopRunContext {
  const registry = new ProviderRegistry([]);
  return { registry, router: { registry }, cwd: repoPath };
}

function spec(commands: string[]): LoopSpec {
  return {
    name: 'noop',
    goal: 'Verify the repo passes its checks.',
    assumptions: [],
    verifier: { commands, successCondition: 'all exit 0' },
    steps: [],
    models: { planner: 'strong', executor: 'coding', reviewer: 'strong', summarizer: 'cheap' },
    limits: { maxIterations: 1, maxCostUsd: 1, maxFilesChanged: 6 },
    safety: { requireApprovalBeforeCommit: false, blockedFiles: ['.env'], allowedPaths: [], allowNetwork: false },
    onSuccess: 'report',
    onFailure: 'report',
  };
}

describe('runLoop', () => {
  it('succeeds immediately when the verifier already passes', async () => {
    const result = await runLoop(spec(['true']), ctx(), { loopId: 'test-pass' });
    expect(result.status).toBe('succeeded');
    expect(result.iterations[0]?.status).toBe('pass');
    expect(result.reason).toMatch(/already passing/i);
  });

  it('reports failure path bookkeeping when no editor is configured', async () => {
    // Verifier fails; with no ready editable provider the edit phase
    // cannot proceed, so the loop ends as failed (not hung).
    const result = await runLoop(spec(['false']), ctx(), { loopId: 'test-fail' });
    expect(['failed', 'stopped']).toContain(result.status);
  });
});

describe('isBlocked', () => {
  it('matches exact basenames and glob patterns', () => {
    expect(isBlocked('config/.env', ['.env'])).toBe(true);
    expect(isBlocked('keys/server.pem', ['*.pem'])).toBe(true);
    expect(isBlocked('src/index.ts', ['.env', '*.pem'])).toBe(false);
    expect(isBlocked('package-lock.json', ['package-lock.json'])).toBe(true);
  });
});
