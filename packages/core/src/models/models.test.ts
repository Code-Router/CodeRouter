import { describe, expect, it } from 'vitest';
import type { OpenRouterModel } from '../agent/providers/openrouter.js';
import { findCard } from './cards.js';
import { computeQualityBias, type ModelObservation } from './learn.js';
import { resolveCard, UNKNOWN_CODING_PRIOR } from './resolve.js';
import { type Candidate, selectBest } from './select.js';
import { tierForCoding } from './tiers.js';

function cand(over: Partial<Candidate> & { model: string }): Candidate {
  const card = over.card ?? resolveCard(over.model);
  return {
    via: over.via ?? 'openrouter',
    adapter: over.adapter ?? 'openai_compat',
    model: over.model,
    card,
    pricePer1MIn: over.pricePer1MIn ?? card.pricePer1MIn ?? 0,
    pricePer1MOut: over.pricePer1MOut ?? card.pricePer1MOut ?? 0,
    contextWindow: over.contextWindow ?? card.contextWindow,
  };
}

function liveModel(over: Partial<OpenRouterModel> & { id: string }): OpenRouterModel {
  return {
    id: over.id,
    name: over.name,
    context_length: over.context_length ?? 128_000,
    pricing: over.pricing ?? { prompt: '0.000001', completion: '0.000002' },
    architecture: over.architecture,
    supported_parameters: over.supported_parameters,
  } as OpenRouterModel;
}

describe('cards + alias resolution', () => {
  it('resolves CLI + provider-native aliases to one card', () => {
    expect(findCard('opus')?.id).toBe('anthropic/claude-opus-4-5');
    expect(findCard('claude-opus-4-5')?.id).toBe('anthropic/claude-opus-4-5');
    expect(findCard('ANTHROPIC/CLAUDE-OPUS-4-5')?.id).toBe('anthropic/claude-opus-4-5');
    expect(findCard('gpt-5-codex')?.id).toBe('openai/gpt-5-codex');
  });

  it('tiers track the coding score bands', () => {
    expect(tierForCoding(93)).toBe('frontier');
    expect(tierForCoding(70)).toBe('strong');
    expect(tierForCoding(50)).toBe('mid');
    expect(tierForCoding(20)).toBe('small');
  });
});

describe('resolveCard conservative prior', () => {
  it('gives unknown models a low coding prior (no name optimism)', () => {
    // The qwen-9b regression: an unverified small model must NOT inherit
    // a "qwen3 = strong" rating.
    const card = resolveCard('qwen/qwen3.5-9b');
    expect(card.quality.coding).toBe(UNKNOWN_CODING_PRIOR);
    expect(tierForCoding(card.quality.coding)).toBe('small');
  });

  it('merges live price/context onto a curated prior', () => {
    const live = liveModel({
      id: 'anthropic/claude-opus-4-5',
      context_length: 250_000,
      pricing: { prompt: '0.00002', completion: '0.00009' },
    });
    const card = resolveCard('anthropic/claude-opus-4-5', live);
    expect(card.quality.coding).toBe(93); // prior preserved
    expect(card.contextWindow).toBe(250_000); // live wins
    expect(card.pricePer1MIn).toBeCloseTo(20, 5);
  });

  it('derives capabilities from live metadata for unknown models', () => {
    const live = liveModel({
      id: 'some-vendor/mystery-large',
      architecture: { input_modalities: ['text', 'image'] },
      supported_parameters: ['tools'],
    });
    const card = resolveCard('some-vendor/mystery-large', live);
    expect(card.tools).toBe(true);
    expect(card.inputs).toContain('image');
    expect(card.quality.coding).toBe(UNKNOWN_CODING_PRIOR);
  });
});

describe('selectBest', () => {
  it('never lets a cheap unknown small model outrank a frontier model', () => {
    const frontier = cand({ model: 'anthropic/claude-opus-4-5' });
    const cheapUnknown = cand({
      model: 'qwen/qwen3.5-9b',
      pricePer1MIn: 0.01,
      pricePer1MOut: 0.01,
      contextWindow: 128_000,
    });
    const sel = selectBest([cheapUnknown, frontier], { objective: 'quality' });
    expect(sel?.candidate.model).toBe('anthropic/claude-opus-4-5');
  });

  it('enforces the quality floor', () => {
    const mid = cand({ model: 'openai/gpt-4o' }); // coding 67 -> strong
    const small = cand({ model: 'qwen/qwen3.5-9b' }); // 40 -> small
    const sel = selectBest([small, mid], { floor: 'strong', objective: 'quality' });
    expect(sel?.candidate.model).toBe('openai/gpt-4o');
    expect(sel?.belowFloor).toBe(false);
  });

  it('falls back to best-available when nothing clears the floor', () => {
    const small = cand({ model: 'qwen/qwen3.5-9b' });
    const sel = selectBest([small], { floor: 'frontier' });
    expect(sel?.candidate.model).toBe('qwen/qwen3.5-9b');
    expect(sel?.belowFloor).toBe(true);
  });

  it('cost only breaks ties among equal-quality models', () => {
    const a = cand({ model: 'anthropic/claude-opus-4-5', pricePer1MIn: 15, pricePer1MOut: 75 });
    const b = cand({ model: 'anthropic/claude-opus-4-5', via: 'anthropic', pricePer1MIn: 0, pricePer1MOut: 0 });
    const sel = selectBest([a, b], { objective: 'quality' });
    expect(sel?.candidate.via).toBe('anthropic'); // cheaper of the tie
  });

  it('cost objective picks cheapest model clearing the floor', () => {
    const flash = cand({ model: 'google/gemini-2.5-flash' }); // ~0.375 total
    const opus = cand({ model: 'anthropic/claude-opus-4-5' }); // ~90 total
    const sel = selectBest([opus, flash], { floor: 'mid', objective: 'cost' });
    expect(sel?.candidate.model).toBe('google/gemini-2.5-flash');
  });

  it('respects capability requirements (tools, vision)', () => {
    const visionless = cand({ model: 'deepseek/deepseek-r1' }); // text-only, tools:false
    const opus = cand({ model: 'anthropic/claude-opus-4-5' });
    const sel = selectBest([visionless, opus], { requireVision: true, requireTools: true });
    expect(sel?.candidate.model).toBe('anthropic/claude-opus-4-5');
  });
});

describe('computeQualityBias (learn)', () => {
  function obs(model: string, n: number, success: boolean, rating: number | null = null): ModelObservation[] {
    return Array.from({ length: n }, () => ({ model, success, rating }));
  }

  it('ignores models below the sample floor', () => {
    const bias = computeQualityBias(obs('m', 2, false), { minSamples: 3 });
    expect(bias.has('m')).toBe(false);
  });

  it('applies a bounded, shrinkage-weighted delta', () => {
    const bias = computeQualityBias(obs('good', 40, true, 1), { maxDelta: 12 });
    const d = bias.get('good') ?? 0;
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(12);
  });

  it('pushes consistently failing models down', () => {
    const bias = computeQualityBias(obs('bad', 30, false, -1));
    expect((bias.get('bad') ?? 0)).toBeLessThan(0);
  });

  it('shrinks the delta when samples are few', () => {
    const many = computeQualityBias(obs('m', 50, true, 1)).get('m') ?? 0;
    const few = computeQualityBias(obs('f', 4, true, 1)).get('f') ?? 0;
    expect(many).toBeGreaterThan(few);
  });
});
