import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStore, type Store } from './index.js';

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cr-store-'));
  store = await openStore(join(dir, '.coderouter', 'memory.db'));
});

afterEach(async () => {
  store.db.close();
  await rm(dir, { recursive: true, force: true });
});

describe('Store: runs', () => {
  it('inserts and reads back a run', () => {
    store.runs.insert({
      id: 'run-1',
      sessionId: null,
      mode: 'agent',
      taskType: 'feature',
      prompt: 'add a delete button',
      status: 'success',
      costUsd: 0.1,
      tokensIn: 100,
      tokensOut: 200,
      durationMs: 1500,
      routes: [{ provider: 'openai', model: 'gpt-5', rationale: 'gpt-5 for deep reasoning' }],
      rationale: 'instant: trivial',
      diff: 'diff body',
      filesChanged: ['src/Btn.tsx'],
      validators: [],
      effectiveness: null,
      rating: null,
      createdAt: Date.now(),
    });
    const got = store.runs.get('run-1');
    expect(got?.status).toBe('success');
    expect(got?.routes).toHaveLength(1);
    expect(store.runs.list()).toHaveLength(1);
  });

  it('updates rating', () => {
    store.runs.insert({
      id: 'run-2',
      sessionId: null,
      mode: 'agent',
      taskType: 'feature',
      prompt: 'p',
      status: 'success',
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 1,
      routes: [],
      rationale: '',
      diff: null,
      filesChanged: [],
      validators: [],
      effectiveness: null,
      rating: null,
      createdAt: Date.now(),
    });
    store.runs.setRating('run-2', 1);
    expect(store.runs.get('run-2')?.rating).toBe(1);
  });
});

describe('Store: sessions', () => {
  it('upsert + get respects TTL', () => {
    store.sessions.upsert({
      id: 's1',
      mode: 'agent',
      worktreePath: null,
      classificationJson: null,
      costAccumulated: 0,
      tokensIn: 0,
      tokensOut: 0,
      lastDiff: null,
      handoffHistoryJson: '[]',
      ttlMs: 60_000,
    });
    expect(store.sessions.get('s1')?.mode).toBe('agent');
  });

  it('prune removes expired sessions', () => {
    store.sessions.upsert({
      id: 's2',
      mode: 'agent',
      worktreePath: null,
      classificationJson: null,
      costAccumulated: 0,
      tokensIn: 0,
      tokensOut: 0,
      lastDiff: null,
      handoffHistoryJson: '[]',
      ttlMs: -1,
    });
    const removed = store.sessions.prune();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(store.sessions.get('s2')).toBeUndefined();
  });
});

describe('Store: learned examples', () => {
  it('inserts then dedups identical prompts', () => {
    const a = store.learned.insert({
      prompt: 'fix typo in README',
      taskType: 'trivial',
      shape: {
        deepReasoning: 0,
        multiFileTaste: 0,
        hugeContext: 0,
        adversarial: 0,
        algorithmic: 0,
        exploratory: 0,
      },
    });
    const b = store.learned.insert({
      prompt: 'fix the typo in README',
      taskType: 'trivial',
      shape: {
        deepReasoning: 0,
        multiFileTaste: 0,
        hugeContext: 0,
        adversarial: 0,
        algorithmic: 0,
        exploratory: 0,
      },
    });
    expect(a).toBe(true);
    expect(b).toBe(false);
    expect(store.learned.count()).toBe(1);
  });
});

describe('Store: facts / overrides / failures', () => {
  it('facts upsert', () => {
    store.facts.set('pkg-manager', 'pnpm', 'detect');
    expect(store.facts.get('pkg-manager')?.value).toBe('pnpm');
    store.facts.set('pkg-manager', 'bun', 'user-override');
    expect(store.facts.get('pkg-manager')?.value).toBe('bun');
  });

  it('overrides match by regex', () => {
    store.overrides.add({
      promptPattern: 'security audit',
      route: 'openai,gpt-5-reasoning',
      reason: 'prefers deep reasoner',
    });
    expect(store.overrides.matchRoute('please run a security audit')?.route).toBe(
      'openai,gpt-5-reasoning',
    );
    expect(store.overrides.matchRoute('rename foo')).toBeUndefined();
  });

  it('failures aggregate counts', () => {
    store.failures.upsert('codex,gpt-5-codex', 'react-components');
    store.failures.upsert('codex,gpt-5-codex', 'react-components');
    const top = store.failures.topFailures('react-components', 2);
    expect(top).toHaveLength(1);
    expect(top[0]?.failCount).toBe(2);
  });
});
