import { afterEach, describe, expect, it } from 'vitest';
import { defaultProviders, ProviderRegistry } from './registry.js';

describe('ProviderRegistry', () => {
  it('resolves a default openai route', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const reg = new ProviderRegistry(defaultProviders());
    const r = reg.resolve('openai,gpt-5');
    expect(r.providerName).toBe('openai');
    expect(r.model).toBe('gpt-5');
    expect(r.adapter.capabilities.contextWindow).toBe(400_000);
  });

  it('resolves an openai_compat provider with overrides', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    const reg = new ProviderRegistry(defaultProviders());
    const r = reg.resolve('deepseek,deepseek-reasoner');
    expect(r.adapter.capabilities.reasoning).toBe(true);
    expect(r.adapter.capabilities.pricePer1MIn).toBe(0.55);
  });

  it('throws for unknown providers and models', () => {
    const reg = new ProviderRegistry(defaultProviders());
    expect(() => reg.resolve('nope,nope')).toThrow(/unknown provider/);
    expect(() => reg.resolve('openai,nope-9000')).toThrow(/unknown model/);
  });

  it('caches the resolved adapter (same instance on repeat)', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const reg = new ProviderRegistry(defaultProviders());
    const a = reg.resolve('openai,gpt-5');
    const b = reg.resolve('openai,gpt-5');
    expect(a.adapter).toBe(b.adapter);
  });

  it('handles models with commas in the name (e.g. openrouter/anthropic/...)', () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const reg = new ProviderRegistry(defaultProviders());
    const r = reg.resolve('openrouter,anthropic/claude-opus-4-5');
    expect(r.model).toBe('anthropic/claude-opus-4-5');
  });

  it('resolves the openrouter_agent provider with canEdit:true', () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const reg = new ProviderRegistry(defaultProviders());
    const r = reg.resolve('openrouter_agent,anthropic/claude-sonnet-4-5');
    expect(r.adapter.id).toBe('coderouter_agent');
    expect(r.adapter.capabilities.canEdit).toBe(true);
    expect(r.adapter.capabilities.tools).toBe(true);
    expect(r.adapter.capabilities.family).toBe('agent-loop');
  });

  it('marks openrouter_agent ready when OPENROUTER_API_KEY is set', () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const reg = new ProviderRegistry(defaultProviders());
    expect(reg.isReady('openrouter_agent')).toBe(true);
  });

  it('marks openrouter_agent NOT ready without an api key', () => {
    delete process.env.OPENROUTER_API_KEY;
    const reg = new ProviderRegistry(defaultProviders());
    expect(reg.isReady('openrouter_agent')).toBe(false);
  });
});

describe('ProviderRegistry dynamic OpenRouter catalog', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('resolves a catalog-only model via dynamicCatalog: openrouter', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    process.env.XDG_CACHE_HOME = `/tmp/cr-test-${Math.random().toString(36).slice(2)}`;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'deepseek/deepseek-chat-v9000',
              name: 'DeepSeek v9000',
              context_length: 64_000,
              pricing: { prompt: '0.00000027', completion: '0.0000011' },
              supported_parameters: ['tools'],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;
    const reg = new ProviderRegistry(defaultProviders());
    await reg.loadOpenRouterCatalog({ force: true });
    const r = reg.resolve('openrouter_agent,deepseek/deepseek-chat-v9000');
    expect(r.adapter.id).toBe('coderouter_agent');
    expect(r.adapter.capabilities.canEdit).toBe(true);
    expect(r.adapter.capabilities.contextWindow).toBe(64_000);
    expect(r.adapter.capabilities.pricePer1MIn).toBeCloseTo(0.27, 2);
  });

  it('refuses non-tool-capable catalog models for the agent provider', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    process.env.XDG_CACHE_HOME = `/tmp/cr-test-${Math.random().toString(36).slice(2)}`;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'random/no-tools',
              name: 'No Tools',
              context_length: 8_000,
              pricing: { prompt: '0', completion: '0' },
              supported_parameters: ['temperature'],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;
    const reg = new ProviderRegistry(defaultProviders());
    await reg.loadOpenRouterCatalog({ force: true });
    expect(() => reg.resolve('openrouter_agent,random/no-tools')).toThrow(/unknown model/);
  });

  it('static models still take precedence over the dynamic catalog', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    process.env.XDG_CACHE_HOME = `/tmp/cr-test-${Math.random().toString(36).slice(2)}`;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'anthropic/claude-sonnet-4-5',
              name: 'should not win',
              context_length: 1_000_000,
              pricing: { prompt: '0', completion: '0' },
              supported_parameters: ['tools'],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;
    const reg = new ProviderRegistry(defaultProviders());
    await reg.loadOpenRouterCatalog({ force: true });
    const r = reg.resolve('openrouter_agent,anthropic/claude-sonnet-4-5');
    // Static catalog declares 200_000; the catalog stub tries 1_000_000.
    expect(r.adapter.capabilities.contextWindow).toBe(200_000);
  });
});
