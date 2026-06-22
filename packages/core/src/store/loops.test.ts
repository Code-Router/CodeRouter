import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoopRecord } from '../loops/types.js';
import { openStore, type Store } from './index.js';

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cr-store-'));
  store = await openStore(join(dir, 'memory.db'));
});
afterEach(async () => {
  store.db.close();
  await rm(dir, { recursive: true, force: true });
});

function rec(id: string): LoopRecord {
  const now = Date.now();
  return {
    id,
    name: 'fix-tests',
    goal: 'Fix failing tests',
    cwd: dir,
    status: 'draft',
    spec: {
      name: 'fix-tests',
      goal: 'Fix failing tests',
      assumptions: [],
      verifier: { commands: ['npm test'], successCondition: 'all exit 0' },
      steps: [],
      models: { planner: 'strong', executor: 'coding', reviewer: 'strong', summarizer: 'cheap' },
      limits: { maxIterations: 6, maxCostUsd: 2.5, maxFilesChanged: 6 },
      safety: { requireApprovalBeforeCommit: true, blockedFiles: [], allowedPaths: [], allowNetwork: false },
      onSuccess: 'report',
      onFailure: 'report',
    },
    iterationsDone: 0,
    costUsd: 0,
    filesChanged: [],
    lastDiff: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('migration v2 + LoopStore', () => {
  it('applies migration v2 (tables present)', () => {
    expect(store.db.userVersion()).toBeGreaterThanOrEqual(2);
  });

  it('inserts, updates, and lists loops + iterations', () => {
    store.loops.insert(rec('loop-1'));
    expect(store.loops.get('loop-1')?.name).toBe('fix-tests');

    store.loops.setStatus('loop-1', 'running');
    expect(store.loops.get('loop-1')?.status).toBe('running');

    store.loops.insertIteration({
      id: 'it-1',
      loopId: 'loop-1',
      index: 0,
      runId: null,
      phase: 'verify',
      status: 'fail',
      verifier: [{ command: 'npm test', exitCode: 1, ok: false, durationMs: 10, output: 'boom' }],
      diff: null,
      summary: '',
      costUsd: 0,
      createdAt: Date.now(),
    });
    const its = store.loops.iterations('loop-1');
    expect(its).toHaveLength(1);
    expect(its[0]?.verifier[0]?.ok).toBe(false);

    expect(store.loops.list()).toHaveLength(1);
    store.loops.delete('loop-1');
    expect(store.loops.get('loop-1')).toBeUndefined();
  });
});

describe('ChatStore', () => {
  it('persists sessions and messages with running totals', () => {
    store.chats.ensureSession({ id: 's1', cwd: dir, mode: 'agent', title: 'hello' });
    store.chats.appendMessage({
      sessionId: 's1', role: 'user', text: 'hi', runId: null, route: null,
      tokensIn: 0, tokensOut: 0, costUsd: 0,
    });
    store.chats.appendMessage({
      sessionId: 's1', role: 'assistant', text: 'hello there', runId: 'r1', route: 'openai,gpt',
      tokensIn: 10, tokensOut: 20, costUsd: 0.01,
    });
    const session = store.chats.getSession('s1');
    expect(session?.messageCount).toBe(2);
    expect(session?.costUsd).toBeCloseTo(0.01);
    const msgs = store.chats.messages('s1');
    expect(msgs).toHaveLength(2);
    expect(msgs[1]?.text).toBe('hello there');
  });
});
