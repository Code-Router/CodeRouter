import { describe, expect, it } from 'vitest';
import { OllamaAdapter } from '../adapters/ollama.js';
import { OpenAICompatAdapter } from '../adapters/openaiCompat.js';
import { applyTransformers, extractJsonBlock, maxTokens, reasoning, streaming } from './index.js';
import type { TransformerContext } from './types.js';

const ctx = (overrides: Partial<TransformerContext> = {}): TransformerContext => ({
  providerName: 'openai',
  capabilities: {
    canEdit: false,
    canPlan: true,
    longContext: false,
    reasoning: true,
    tools: true,
    streaming: true,
    vision: false,
    pricePer1MIn: 1,
    pricePer1MOut: 1,
    contextWindow: 128_000,
    family: 'api-model',
  },
  ...overrides,
});

describe('reasoning transformer', () => {
  it('strips <thinking>...</thinking> blocks from output', () => {
    const result = reasoning.transformOut!(
      {
        text: '<thinking>plan ideas</thinking>\nFinal answer.',
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0,
        durationMs: 1,
      },
      ctx(),
    );
    expect(result.text).toBe('Final answer.');
  });

  it('removes reasoningEffort when capability is missing', () => {
    const input = reasoning.transformIn!(
      { prompt: 'x', reasoningEffort: 'medium' },
      ctx({ capabilities: { ...ctx().capabilities!, reasoning: false } }),
    );
    expect(input.reasoningEffort).toBeUndefined();
  });
});

describe('maxTokens transformer', () => {
  it('clamps over-budget values per provider', () => {
    const out = maxTokens.transformIn!(
      { prompt: 'x', maxTokens: 100_000 },
      ctx({ providerName: 'anthropic' }),
    );
    expect(out.maxTokens).toBe(8_000);
  });
  it('fills in default when undefined', () => {
    const out = maxTokens.transformIn!({ prompt: 'x' }, ctx({ providerName: 'openai' }));
    expect(out.maxTokens).toBe(16_000);
  });
});

describe('streaming transformer', () => {
  it('normalizes trailing whitespace and CRLF', () => {
    const out = streaming.transformOut!(
      {
        text: 'line1   \r\nline2  \n',
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0,
        durationMs: 1,
      },
      ctx(),
    );
    expect(out.text).toBe('line1\nline2');
  });
});

describe('extractJsonBlock', () => {
  it('extracts fenced json', () => {
    const json = extractJsonBlock<{ pick: string }>(
      '```json\n{"pick":"opus"}\n```',
    );
    expect(json?.pick).toBe('opus');
  });
  it('returns null for invalid', () => {
    expect(extractJsonBlock('no json here')).toBeNull();
  });
});

describe('applyTransformers', () => {
  it('chains transformers around adapter.run', async () => {
    const ollama = new OllamaAdapter({ model: 'llama3.2' });
    const wrapped = applyTransformers(ollama, ['reasoning', 'streaming'], 'ollama');
    // wrapped retains identity for capabilities + estimateCost.
    expect(wrapped.estimateCost(1_000_000, 1_000_000)).toBe(0);
    expect(wrapped.capabilities).toBe(ollama.capabilities);
  });

  it('preserves adapter identity when no transformers requested', () => {
    const a = new OpenAICompatAdapter({
      providerName: 'deepseek',
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'k',
    });
    const wrapped = applyTransformers(a, [], 'deepseek');
    expect(wrapped).toBe(a);
  });
});
