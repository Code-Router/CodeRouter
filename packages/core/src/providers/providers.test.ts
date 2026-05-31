import { describe, expect, it } from 'vitest';
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
});
