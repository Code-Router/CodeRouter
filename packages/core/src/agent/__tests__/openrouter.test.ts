/**
 * Tests for the OpenRouter model catalog module.
 *
 * Stubs `globalThis.fetch` so we can exercise the cache + TTL logic
 * without hitting the real network. Each test runs in its own temp
 * dir so cache files don't leak between cases.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchOpenRouterModels,
  getOpenRouterModel,
  isToolCapable,
  listOpenRouterToolCapableModels,
  pricePer1MIn,
  pricePer1MOut,
  type OpenRouterModel,
} from '../providers/openrouter.js';

let cacheDir: string;
let cachePath: string;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'or-cache-'));
  cachePath = join(cacheDir, 'openrouter-models.json');
});
afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
  globalThis.fetch = realFetch;
});

function model(over: Partial<OpenRouterModel> = {}): OpenRouterModel {
  return {
    id: 'anthropic/claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    context_length: 200_000,
    pricing: { prompt: '0.000003', completion: '0.000015' },
    supported_parameters: ['tools', 'tool_choice'],
    ...over,
  };
}

function stubFetch(data: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('isToolCapable', () => {
  it('returns true when tools is in supported_parameters', () => {
    expect(isToolCapable(model({ supported_parameters: ['tools'] }))).toBe(true);
  });
  it('returns true when tool_choice is in supported_parameters', () => {
    expect(isToolCapable(model({ supported_parameters: ['tool_choice'] }))).toBe(true);
  });
  it('returns false when supported_parameters lacks tools', () => {
    expect(isToolCapable(model({ supported_parameters: ['temperature'] }))).toBe(false);
  });
  it('falls back to known-family allow-list when no supported_parameters', () => {
    expect(isToolCapable(model({ id: 'anthropic/x', supported_parameters: undefined }))).toBe(true);
    expect(isToolCapable(model({ id: 'random/unknown', supported_parameters: undefined }))).toBe(false);
  });
});

describe('pricing helpers', () => {
  it('converts per-token strings to per-1M dollars', () => {
    const m = model({ pricing: { prompt: '0.000003', completion: '0.000015' } });
    expect(pricePer1MIn(m)).toBeCloseTo(3);
    expect(pricePer1MOut(m)).toBeCloseTo(15);
  });
  it('handles missing pricing fields as zero', () => {
    const m = { id: 'x', name: 'x', context_length: 1, pricing: { prompt: '', completion: '' } };
    expect(pricePer1MIn(m)).toBe(0);
    expect(pricePer1MOut(m)).toBe(0);
  });
});

describe('fetchOpenRouterModels', () => {
  it('fetches from the network and writes the cache', async () => {
    const fetchFn = stubFetch({ data: [model()] });
    const models = await fetchOpenRouterModels({ cachePath });
    expect(models).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledOnce();
    // Second call within TTL: no extra network round trip.
    const again = await fetchOpenRouterModels({ cachePath });
    expect(again).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('re-fetches when force is true', async () => {
    const fetchFn = stubFetch({ data: [model()] });
    await fetchOpenRouterModels({ cachePath });
    await fetchOpenRouterModels({ cachePath, force: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('falls back to a stale cache on network error', async () => {
    await writeFile(
      cachePath,
      JSON.stringify({ fetchedAt: 0, models: [model({ id: 'cached/model', supported_parameters: ['tools'] })] }),
      'utf8',
    );
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const models = await fetchOpenRouterModels({ cachePath, ttlMs: 0 });
    expect(models[0]?.id).toBe('cached/model');
  });

  it('throws when the network fails AND no cache exists', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(fetchOpenRouterModels({ cachePath })).rejects.toThrow(/offline/);
  });
});

describe('getOpenRouterModel', () => {
  it('returns a single model by id', async () => {
    stubFetch({ data: [model({ id: 'a/b' }), model({ id: 'c/d' })] });
    const m = await getOpenRouterModel('a/b', { cachePath });
    expect(m?.id).toBe('a/b');
  });
  it('returns null for unknown ids', async () => {
    stubFetch({ data: [model({ id: 'a/b' })] });
    const m = await getOpenRouterModel('not/found', { cachePath });
    expect(m).toBeNull();
  });
});

describe('listOpenRouterToolCapableModels', () => {
  it('filters out non-tool-capable models', async () => {
    stubFetch({
      data: [
        model({ id: 'a/b', supported_parameters: ['tools'] }),
        model({ id: 'c/d', supported_parameters: ['temperature'] }),
      ],
    });
    const r = await listOpenRouterToolCapableModels({ cachePath });
    expect(r.map((m) => m.id)).toEqual(['a/b']);
  });
  it('search narrows the result', async () => {
    stubFetch({
      data: [
        model({ id: 'anthropic/claude-sonnet-4-5', supported_parameters: ['tools'] }),
        model({ id: 'openai/gpt-5', supported_parameters: ['tools'] }),
      ],
    });
    const r = await listOpenRouterToolCapableModels({ cachePath, search: 'gpt' });
    expect(r.map((m) => m.id)).toEqual(['openai/gpt-5']);
  });
});
