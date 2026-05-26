import { describe, expect, it, vi } from 'vitest';
import type { Adapter } from '../adapters/types.js';
import { MemoryClassifierCache } from './cache.js';
import { ClassifierCascade } from './cascade.js';
import { buildIndex } from './embed.js';
import { classifierHash } from './hash.js';
import { classifyByRules } from './rules.js';
import type { SeedExample } from './types.js';

const SEED: SeedExample[] = [
  {
    id: 'seed-1',
    prompt: 'add unit tests covering the auth middleware',
    taskType: 'test',
    shape: {
      deepReasoning: 0.3,
      multiFileTaste: 0.4,
      hugeContext: 0.1,
      adversarial: 0.7,
      algorithmic: 0.1,
      exploratory: 0.2,
    },
  },
  {
    id: 'seed-2',
    prompt: 'optimize this dijkstra implementation for sparse graphs',
    taskType: 'refactor',
    shape: {
      deepReasoning: 0.8,
      multiFileTaste: 0.2,
      hugeContext: 0.1,
      adversarial: 0.3,
      algorithmic: 0.95,
      exploratory: 0.2,
    },
  },
  {
    id: 'seed-3',
    prompt: 'sweep the monorepo to migrate from moment to date-fns across every package',
    taskType: 'refactor',
    shape: {
      deepReasoning: 0.4,
      multiFileTaste: 0.85,
      hugeContext: 0.9,
      adversarial: 0.2,
      algorithmic: 0.1,
      exploratory: 0.3,
    },
  },
];

describe('classifyByRules', () => {
  it('classifies a typo fix as trivial with high confidence', () => {
    const c = classifyByRules({ prompt: 'fix typo in README' });
    expect(c?.taskType).toBe('trivial');
    expect(c?.confidence).toBeGreaterThan(0.9);
  });
  it('classifies a debug request as investigation with deepReasoning boost', () => {
    const c = classifyByRules({ prompt: 'debug why the websocket disconnects under load' });
    expect(c?.taskType).toBe('investigation');
    expect(c?.shape.deepReasoning).toBeGreaterThan(0.7);
  });
  it('returns null for prompts that match nothing', () => {
    const c = classifyByRules({ prompt: 'asdf qwer' });
    expect(c).toBeNull();
  });
});

describe('ClassifierCascade', () => {
  it('uses cache on the second call', async () => {
    const cache = new MemoryClassifierCache();
    const c = new ClassifierCascade({ corpus: SEED, cache });
    const a = await c.classify({ prompt: 'fix typo in README' });
    const b = await c.classify({ prompt: 'fix typo in README' });
    expect(a.taskType).toBe('trivial');
    expect(b.source).toBe('cache');
    expect(b.hash).toBe(a.hash);
  });

  it('falls through to embed when rules confidence is low', async () => {
    const c = new ClassifierCascade({ corpus: SEED, rulesConfidenceFloor: 0.99 });
    const out = await c.classify({
      prompt: 'sweep the monorepo to migrate from moment to date-fns across every package',
    });
    // hugeContext seed should dominate via embed.
    expect(out.shape.hugeContext).toBeGreaterThan(0.4);
  });

  it('calls the llm judge when embed is also weak', async () => {
    const judge: Adapter = {
      id: 'openai',
      name: 'judge',
      capabilities: {
        canEdit: false,
        canPlan: false,
        longContext: false,
        reasoning: false,
        tools: false,
        streaming: false,
        vision: false,
        pricePer1MIn: 0,
        pricePer1MOut: 0,
        contextWindow: 8000,
        family: 'api-model',
      },
      run: vi.fn(async () => ({
        text: '```json\n{"taskType":"feature","shape":{"deepReasoning":0.5,"multiFileTaste":0.6,"hugeContext":0.2,"adversarial":0.1,"algorithmic":0.1,"exploratory":0.4},"confidence":0.8,"rationale":"new endpoint"}\n```',
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0,
        durationMs: 1,
      })),
      estimateCost: () => 0,
    };
    const cas = new ClassifierCascade({
      corpus: SEED,
      llmJudge: judge,
      rulesConfidenceFloor: 0.99,
    });
    const out = await cas.classify({ prompt: 'asdfqwer some random thing 12345' });
    expect(out.source).toBe('llm');
    expect(out.taskType).toBe('feature');
  });

  it('hash is stable under whitespace normalization', () => {
    const a = classifierHash({ prompt: '  fix    typo\n in README ' });
    const b = classifierHash({ prompt: 'fix typo in README' });
    expect(a).toBe(b);
  });

  it('hash changes with repoHead', () => {
    const a = classifierHash({ prompt: 'do x', repoHead: 'sha1' });
    const b = classifierHash({ prompt: 'do x', repoHead: 'sha2' });
    expect(a).not.toBe(b);
  });

  it('returns a sensible fallback when nothing matches', async () => {
    const cas = new ClassifierCascade({ corpus: [], rulesConfidenceFloor: 0.99 });
    const out = await cas.classify({ prompt: 'asdfqwer some random thing 12345', noLlm: true });
    expect(out.taskType).toBe('feature');
    expect(out.confidence).toBeLessThanOrEqual(0.5);
  });

  it('buildIndex precomputes vectors per example', () => {
    const idx = buildIndex(SEED);
    expect(idx.examples).toHaveLength(SEED.length);
    expect(idx.examples[0]?.vec.size).toBeGreaterThan(0);
  });
});
