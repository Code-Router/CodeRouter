import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter } from './anthropic.js';
import { OllamaAdapter } from './ollama.js';
import { OpenAIAdapter } from './openai.js';
import { OpenAICompatAdapter } from './openaiCompat.js';

describe('adapter cost estimation', () => {
  it('OpenAIAdapter prices known models', () => {
    const a = new OpenAIAdapter({ model: 'gpt-5', apiKey: 'sk-test' });
    expect(a.estimateCost(1_000_000, 1_000_000)).toBeCloseTo(18, 3);
    expect(a.capabilities.contextWindow).toBe(400_000);
  });

  it('AnthropicAdapter prices opus higher than haiku', () => {
    const opus = new AnthropicAdapter({ model: 'claude-opus-4-1', apiKey: 'sk-test' });
    const haiku = new AnthropicAdapter({ model: 'claude-3-5-haiku-latest', apiKey: 'sk-test' });
    expect(opus.estimateCost(1_000_000, 1_000_000)).toBeGreaterThan(
      haiku.estimateCost(1_000_000, 1_000_000),
    );
  });

  it('OllamaAdapter is always zero cost', () => {
    const o = new OllamaAdapter({ model: 'llama3.2' });
    expect(o.estimateCost(1_000_000, 1_000_000)).toBe(0);
    expect(o.capabilities.pricePer1MIn).toBe(0);
  });

  it('OpenAICompatAdapter takes its capabilities from the registry config', () => {
    const a = new OpenAICompatAdapter({
      providerName: 'deepseek',
      model: 'deepseek-reasoner',
      baseURL: 'https://api.deepseek.com/v1',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      pricePer1MIn: 0.55,
      pricePer1MOut: 2.19,
      contextWindow: 64_000,
      reasoningParam: 'reasoning_effort',
    });
    expect(a.capabilities.reasoning).toBe(true);
    expect(a.capabilities.pricePer1MIn).toBe(0.55);
    expect(a.id).toBe('openai_compat');
    expect(a.name).toBe('deepseek');
  });
});

describe('OpenAICompatAdapter http body', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends prompt + reasoning_effort, parses choices + usage', async () => {
    const adapter = new OpenAICompatAdapter({
      providerName: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
      pricePer1MIn: 3,
      pricePer1MOut: 15,
      contextWindow: 200_000,
      capabilities: { reasoning: true },
    });

    const capturedBody: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const out = await adapter.run({
      prompt: 'hello',
      reasoningEffort: 'medium',
      maxTokens: 200,
    });
    expect(out.text).toBe('ok');
    expect(out.tokensIn).toBe(10);
    expect(out.tokensOut).toBe(20);
    expect(out.costUsd).toBeCloseTo(10 / 1e6 * 3 + 20 / 1e6 * 15, 6);
    expect(capturedBody[0]).toMatchObject({
      model: 'anthropic/claude-sonnet-4',
      max_tokens: 200,
      reasoning_effort: 'medium',
      messages: expect.any(Array),
    });
  });
});
