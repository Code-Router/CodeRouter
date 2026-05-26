import { describe, expect, it } from 'vitest';
import { defaultProviders, ProviderRegistry } from '../providers/registry.js';
import type { Classification } from '../types.js';
import { effortProfile } from './effort.js';
import { matchInstant } from './instant.js';
import { pick, pickStrong } from './policy.js';

function envSetup() {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.GOOGLE_API_KEY = 'sk-test';
  process.env.DEEPSEEK_API_KEY = 'sk-test';
}

function classification(
  partial: Partial<Classification> & { taskType: Classification['taskType'] },
): Classification {
  return {
    hash: 'h',
    source: 'rules',
    confidence: 0.9,
    rationale: '',
    shape: {
      deepReasoning: 0.3,
      multiFileTaste: 0.3,
      hugeContext: 0.1,
      adversarial: 0.2,
      algorithmic: 0.1,
      exploratory: 0.3,
    },
    ...partial,
  };
}

describe('effortProfile', () => {
  it('returns escalating thresholds with effort', () => {
    const low = effortProfile('low');
    const max = effortProfile('max');
    expect(low.tournamentSize).toBe(1);
    expect(max.tournamentSize).toBeGreaterThan(1);
    expect(low.maxCostUsd).toBeLessThan(max.maxCostUsd);
  });
});

describe('matchInstant', () => {
  it('matches typo fixes', () => {
    const m = matchInstant('fix typo in README');
    expect(m.matched).toBe(true);
    if (m.matched) expect(m.pattern.id).toBe('typo-fix');
  });
  it('misses generic feature work', () => {
    expect(matchInstant('implement OAuth').matched).toBe(false);
  });
});

describe('pick()', () => {
  it('routes trivial tasks to a cheap model', () => {
    envSetup();
    const ctx = { registry: new ProviderRegistry(defaultProviders()) };
    const r = pick(classification({ taskType: 'trivial' }), ctx);
    expect(['claude-3-5-haiku-latest', 'gpt-4o-mini', 'deepseek-chat', 'qwen2.5-coder:7b', 'llama3.2']).toContain(r.model);
  });

  it('routes hugeContext shape to Gemini Pro', () => {
    envSetup();
    const ctx = { registry: new ProviderRegistry(defaultProviders()) };
    const r = pick(
      classification({
        taskType: 'investigation',
        shape: {
          deepReasoning: 0.3,
          multiFileTaste: 0.3,
          hugeContext: 0.95,
          adversarial: 0.2,
          algorithmic: 0.1,
          exploratory: 0.3,
        },
      }),
      ctx,
    );
    expect(r.model).toBe('gemini-2.5-pro');
  });

  it('routes deepReasoning shape to GPT-5 reasoning at high effort', () => {
    envSetup();
    const ctx = { registry: new ProviderRegistry(defaultProviders()) };
    const r = pick(
      classification({
        taskType: 'investigation',
        shape: {
          deepReasoning: 0.92,
          multiFileTaste: 0.3,
          hugeContext: 0.1,
          adversarial: 0.4,
          algorithmic: 0.5,
          exploratory: 0.4,
        },
      }),
      ctx,
      { effort: 'high' },
    );
    expect(r.model).toBe('gpt-5-reasoning');
  });

  it('routes multiFileTaste shape to Opus', () => {
    envSetup();
    const ctx = { registry: new ProviderRegistry(defaultProviders()) };
    const r = pick(
      classification({
        taskType: 'refactor',
        shape: {
          deepReasoning: 0.4,
          multiFileTaste: 0.9,
          hugeContext: 0.3,
          adversarial: 0.2,
          algorithmic: 0.1,
          exploratory: 0.3,
        },
      }),
      ctx,
    );
    expect(r.model).toBe('claude-opus-4-1');
  });

  it('honors a route override', () => {
    envSetup();
    const ctx = {
      registry: new ProviderRegistry(defaultProviders()),
      routeOverrides: [
        {
          taskType: 'feature' as Classification['taskType'],
          routeRef: { provider: 'openai' as const, model: 'gpt-5', rationale: 'forced' },
        },
      ],
    };
    const r = pick(classification({ taskType: 'feature' }), ctx);
    expect(r.model).toBe('gpt-5');
  });

  it('honors memoryBias forbidden routes', () => {
    envSetup();
    const ctx = {
      registry: new ProviderRegistry(defaultProviders()),
      memoryBias: {
        forbiddenRoutes: ['anthropic,claude-opus-4-1'],
      },
    };
    const r = pick(
      classification({
        taskType: 'refactor',
        shape: {
          deepReasoning: 0.4,
          multiFileTaste: 0.9,
          hugeContext: 0.3,
          adversarial: 0.2,
          algorithmic: 0.1,
          exploratory: 0.3,
        },
      }),
      ctx,
    );
    expect(r.model).not.toBe('claude-opus-4-1');
  });
});

describe('pickStrong()', () => {
  it('returns 3 contenders at high effort with diverse shape demands', () => {
    envSetup();
    const ctx = { registry: new ProviderRegistry(defaultProviders()) };
    const top = pickStrong(
      classification({
        taskType: 'feature',
        shape: {
          deepReasoning: 0.9,
          multiFileTaste: 0.85,
          hugeContext: 0.7,
          adversarial: 0.4,
          algorithmic: 0.3,
          exploratory: 0.5,
        },
      }),
      ctx,
      'high',
    );
    expect(top.length).toBeGreaterThanOrEqual(2);
    expect(top.length).toBeLessThanOrEqual(3);
    const models = top.map((r) => r.model);
    expect(models).toContain('gpt-5-reasoning');
  });
});
