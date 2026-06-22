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
  // Force "no local CLIs" so routing decisions in these tests are
  // deterministic regardless of whether codex / claude / ollama are on
  // the developer's machine. `whichSync` reads PATH at call time.
  process.env.PATH = '';
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

  it('routes deepReasoning shape to GPT-5 at high effort', () => {
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
    // GPT-5 is itself a reasoning model; the effort knob is the
    // `reasoning_effort` request param, not a separate model name.
    expect(r.model).toBe('gpt-5');
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
    expect(r.model).toBe('claude-opus-4-5');
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

  it('honors a preferred strong model for complex shapes', () => {
    envSetup();
    const ctx = {
      registry: new ProviderRegistry(defaultProviders()),
      preferredModels: {
        strong: {
          provider: 'anthropic' as const,
          model: 'claude-sonnet-4-5',
          via: 'anthropic',
          rationale: '',
        },
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
    // Without the preference this multi-file shape resolves to Opus;
    // the user's strong pick wins instead.
    expect(r.model).toBe('claude-sonnet-4-5');
    expect(r.rationale).toBe('preferred-strong');
  });

  it('honors a preferred cheap model for trivial tasks', () => {
    envSetup();
    const ctx = {
      registry: new ProviderRegistry(defaultProviders()),
      preferredModels: {
        cheap: {
          provider: 'deepseek' as const,
          model: 'deepseek-chat',
          via: 'deepseek',
          rationale: '',
        },
      },
    };
    const r = pick(classification({ taskType: 'trivial' }), ctx);
    expect(r.model).toBe('deepseek-chat');
    expect(r.rationale).toBe('preferred-cheap:trivial');
  });

  it('ignores a preferred model whose provider is not configured', () => {
    envSetup();
    delete process.env.GROQ_API_KEY;
    const ctx = {
      registry: new ProviderRegistry(defaultProviders()),
      preferredModels: {
        cheap: {
          provider: 'openai_compat' as const,
          model: 'llama-3.3-70b-versatile',
          via: 'groq',
          rationale: '',
        },
      },
    };
    const r = pick(classification({ taskType: 'trivial' }), ctx);
    // Groq isn't configured, so the stale preference is skipped and we
    // fall back to a normally-routed cheap model.
    expect(r.model).not.toBe('llama-3.3-70b-versatile');
  });

  it('honors memoryBias forbidden routes', () => {
    envSetup();
    const ctx = {
      registry: new ProviderRegistry(defaultProviders()),
      memoryBias: {
        forbiddenRoutes: ['anthropic,claude-opus-4-5'],
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
    expect(r.model).not.toBe('claude-opus-4-5');
  });

  it('honors a memoryBias preferred route when its provider is ready', () => {
    envSetup();
    const ctx = {
      registry: new ProviderRegistry(defaultProviders()),
      memoryBias: {
        preferredRoutes: [
          { route: 'anthropic,claude-sonnet-4-5', reason: '90% success across 5 runs' },
        ],
      },
    };
    const r = pick(classification({ taskType: 'feature' }), ctx);
    expect(r.model).toBe('claude-sonnet-4-5');
    expect(r.rationale).toContain('memory:');
  });

  it('skips a memoryBias preferred route whose provider was disabled', () => {
    // Regression: a provider with a strong historical success rate
    // (e.g. claude_code) must NOT be picked once the user disables it.
    // envSetup() blanks PATH so claude_code's binary check fails ->
    // isReady('claude_code') is false, mirroring a /setup toggle-off.
    envSetup();
    const ctx = {
      registry: new ProviderRegistry(defaultProviders()),
      memoryBias: {
        preferredRoutes: [
          { route: 'claude_code,sonnet', reason: '100% success across 4 runs' },
        ],
      },
    };
    const r = pick(classification({ taskType: 'feature' }), ctx);
    expect(r.provider).not.toBe('claude_code');
    expect(r.rationale).not.toContain('memory:');
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
    expect(models).toContain('gpt-5');
  });
});

describe('pick with requiresVision', () => {
  it('returns a vision-capable model when requiresVision is set', () => {
    envSetup();
    const ctx = { registry: new ProviderRegistry(defaultProviders()) };
    const route = pick(
      classification({ taskType: 'feature' }),
      ctx,
      { requiresVision: true },
    );
    // Should pick a model that has visionInput in the static catalog
    // (openai, anthropic, or google all have it)
    expect(route.model).not.toBe('no-vision-model');
    expect(route.rationale).toMatch(/vision/);
  });

  it('returns no-vision-model sentinel when no vision provider is ready', () => {
    // No API keys set, no CLIs on PATH -> nothing is ready
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.PATH = '';
    const ctx = { registry: new ProviderRegistry(defaultProviders()) };
    const route = pick(
      classification({ taskType: 'feature' }),
      ctx,
      { requiresVision: true },
    );
    expect(route.model).toBe('no-vision-model');
  });

  it('resolves a vision route when only OpenRouter is configured', () => {
    // Regression: OpenRouter's static catalog entries carry no static
    // `visionInput` flag (their real model is picked dynamically), so a
    // naive static gate dropped them under requiresVision and the router
    // fell back to the `no-vision-model` sentinel even though OpenRouter
    // has plenty of vision models.
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GROQ_API_KEY;
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.PATH = '';
    const ctx = { registry: new ProviderRegistry(defaultProviders()) };
    const route = pick(
      classification({ taskType: 'feature' }),
      ctx,
      { requiresVision: true },
    );
    expect(route.model).not.toBe('no-vision-model');
    expect(route.via).toMatch(/openrouter/);
    expect(route.rationale).toMatch(/vision/);
  });

  it('bypasses memory-biased non-vision routes when requiresVision is set', () => {
    envSetup();
    const ctx = {
      registry: new ProviderRegistry(defaultProviders()),
      memoryBias: {
        preferredRoutes: [{ route: 'deepseek,deepseek-chat', reason: 'cheap' }],
      },
    };
    const route = pick(
      classification({ taskType: 'feature' }),
      ctx,
      { requiresVision: true },
    );
    // DeepSeek doesn't have visionInput in the catalog, so it should be skipped
    expect(route.provider).not.toBe('deepseek');
    expect(route.rationale).toMatch(/vision/);
  });
});
