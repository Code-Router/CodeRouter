import { describe, expect, it } from 'vitest';
import type { OpenRouterModel } from '../../agent/providers/openrouter.js';
import { qualityTier } from './quality.js';
import { selectSmartModel, selectSmartModels } from './select.js';

/** Build a minimal OpenRouterModel. Prices are USD per 1M tokens. */
function model(
  id: string,
  ctx: number,
  inPer1M: number,
  outPer1M: number,
  params: string[] = ['tools'],
  modalities: string[] = [],
): OpenRouterModel {
  return {
    id,
    name: id,
    context_length: ctx,
    pricing: { prompt: String(inPer1M / 1_000_000), completion: String(outPer1M / 1_000_000) },
    supported_parameters: params,
    ...(modalities.length > 0 ? { architecture: { input_modalities: modalities } } : {}),
  };
}

const CATALOG: OpenRouterModel[] = [
  model('anthropic/claude-opus-4', 200_000, 15, 75, ['tools'], ['text', 'image']),
  model('anthropic/claude-sonnet-4', 200_000, 3, 15, ['tools'], ['text', 'image']),
  model('openai/gpt-5', 400_000, 5, 15, ['tools', 'reasoning'], ['text', 'image']),
  model('openai/gpt-4o', 128_000, 2.5, 10, ['tools'], ['text', 'image']),
  model('openai/gpt-4o-mini', 128_000, 0.15, 0.6, ['tools'], ['text', 'image']),
  model('deepseek/deepseek-chat', 128_000, 0.27, 1.1, ['tools'], ['text']),
  model('google/gemini-2.5-pro', 1_000_000, 1.25, 10, ['tools', 'reasoning'], ['text', 'image']),
  model('meta-llama/llama-3.1-8b-instruct:free', 8_000, 0, 0, ['tools'], ['text']),
  model('someorg/textonly-2', 32_000, 0.5, 0.5, [], ['text']),
];

describe('qualityTier', () => {
  it('classifies known families', () => {
    expect(qualityTier('anthropic/claude-opus-4')).toBe('frontier');
    expect(qualityTier('openai/gpt-5')).toBe('frontier');
    expect(qualityTier('anthropic/claude-sonnet-4')).toBe('frontier');
    expect(qualityTier('openai/gpt-4o')).toBe('strong');
    expect(qualityTier('deepseek/deepseek-chat')).toBe('strong');
    expect(qualityTier('openai/gpt-4o-mini')).toBe('small');
    expect(qualityTier('anthropic/claude-3-5-haiku')).toBe('small');
    expect(qualityTier('whoever/mystery-model')).toBe('unknown');
  });

  it('prefers the small tier over a strong substring match (gpt-4o-mini)', () => {
    expect(qualityTier('openai/gpt-4o-mini')).toBe('small');
  });
});

describe('selectSmartModel constraints', () => {
  it('excludes non-tool models when requireTools is set', () => {
    const ranked = selectSmartModels(CATALOG, 'balanced-agent', { requireTools: true });
    expect(ranked.find((m) => m.id === 'someorg/textonly-2')).toBeUndefined();
  });

  it('excludes free ($0/$0) models by default', () => {
    const ranked = selectSmartModels(CATALOG, 'fast-cheap');
    expect(ranked.find((m) => m.id.endsWith(':free'))).toBeUndefined();
  });

  it('includes free models when allowFree is set', () => {
    const ranked = selectSmartModels(CATALOG, 'fast-cheap', { allowFree: true });
    expect(ranked.find((m) => m.id.endsWith(':free'))).toBeDefined();
  });

  it('returns nothing for local-offline (OpenRouter is not local)', () => {
    expect(selectSmartModels(CATALOG, 'local-offline')).toEqual([]);
  });
});

describe('selectSmartModel per-intent behaviour', () => {
  it('huge-context picks a large-context model and never a 128k one', () => {
    const best = selectSmartModel(CATALOG, 'huge-context');
    expect(best).not.toBeNull();
    expect(best!.contextWindow).toBeGreaterThanOrEqual(200_000);
    // gemini-2.5-pro has the biggest window here.
    expect(best!.id).toBe('google/gemini-2.5-pro');
  });

  it('deep-reasoning picks a reasoning-capable frontier model', () => {
    const best = selectSmartModel(CATALOG, 'deep-reasoning');
    expect(best).not.toBeNull();
    expect(['openai/gpt-5', 'google/gemini-2.5-pro']).toContain(best!.id);
  });

  it('fast-cheap favours a cheap model, not the priciest', () => {
    const best = selectSmartModel(CATALOG, 'fast-cheap');
    expect(best).not.toBeNull();
    expect(best!.id).not.toBe('anthropic/claude-opus-4');
    const sum = best!.pricePer1MIn + best!.pricePer1MOut;
    expect(sum).toBeLessThan(5);
  });

  it('multi-file requires tools and a roomy context', () => {
    const best = selectSmartModel(CATALOG, 'multi-file');
    expect(best).not.toBeNull();
    expect(best!.contextWindow).toBeGreaterThanOrEqual(60_000);
  });

  it('returns null when the catalog is empty', () => {
    expect(selectSmartModel([], 'balanced-agent')).toBeNull();
  });
});

describe('selectSmartModel requireVision', () => {
  it('excludes non-vision models when requireVision is set', () => {
    const ranked = selectSmartModels(CATALOG, 'balanced-agent', { requireVision: true });
    for (const m of ranked) {
      expect(m.id).not.toBe('deepseek/deepseek-chat');
      expect(m.id).not.toBe('someorg/textonly-2');
    }
  });

  it('keeps vision-capable models when requireVision is set', () => {
    const ranked = selectSmartModels(CATALOG, 'balanced-agent', { requireVision: true });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.find((m) => m.id === 'openai/gpt-4o')).toBeDefined();
  });

  it('returns null when no vision model qualifies', () => {
    const textOnly = [
      model('text/only-a', 128_000, 1, 2, ['tools'], ['text']),
      model('text/only-b', 64_000, 0.5, 1, [], ['text']),
    ];
    const result = selectSmartModel(textOnly, 'balanced-agent', { requireVision: true });
    expect(result).toBeNull();
  });
});
