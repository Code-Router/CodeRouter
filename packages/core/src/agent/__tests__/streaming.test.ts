/**
 * Tests for the SSE streaming path in OpenAICompatTransport.
 *
 * We mock `fetch` to return an SSE stream, then verify:
 *  - onDelta is called with correct content/reasoning deltas
 *  - tool_calls are assembled from incremental fragments
 *  - usage is captured from the final chunk
 *  - the returned ChatTurnResponse has streamed=true
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatTransport } from '../transport/openaiCompat.js';

function ssePayload(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function createFakeSSEResponse(events: string[]): Response {
  const body = events.join('') + 'data: [DONE]\n\n';
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('OpenAICompatTransport streaming', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('streams content and reasoning deltas and assembles tool calls', async () => {
    const events = [
      ssePayload({
        choices: [{ delta: { reasoning_content: 'Let me ' }, finish_reason: null }],
      }),
      ssePayload({
        choices: [{ delta: { reasoning_content: 'think...' }, finish_reason: null }],
      }),
      ssePayload({
        choices: [{ delta: { content: 'Hello' }, finish_reason: null }],
      }),
      ssePayload({
        choices: [{ delta: { content: ' world' }, finish_reason: null }],
      }),
      ssePayload({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'tc_1',
              function: { name: 'grep', arguments: '{"pat' },
            }],
          },
          finish_reason: null,
        }],
      }),
      ssePayload({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: 'tern":"foo"}' },
            }],
          },
          finish_reason: 'stop',
        }],
      }),
      ssePayload({
        choices: [],
        usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.002 },
      }),
    ];

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      createFakeSSEResponse(events),
    );

    const transport = new OpenAICompatTransport({
      providerName: 'test',
      model: 'test-model',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });

    const contentDeltas: string[] = [];
    const reasoningDeltas: string[] = [];

    const result = await transport.sendTurn({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
      onDelta: (d) => {
        if (d.content) contentDeltas.push(d.content);
        if (d.reasoning) reasoningDeltas.push(d.reasoning);
      },
    });

    expect(result.streamed).toBe(true);
    expect(result.message.content).toBe('Hello world');
    expect(result.reasoning).toBe('Let me think...');
    expect(contentDeltas).toEqual(['Hello', ' world']);
    expect(reasoningDeltas).toEqual(['Let me ', 'think...']);

    expect(result.message.tool_calls).toHaveLength(1);
    expect(result.message.tool_calls![0]!.id).toBe('tc_1');
    expect(result.message.tool_calls![0]!.function.name).toBe('grep');
    expect(result.message.tool_calls![0]!.function.arguments).toBe('{"pattern":"foo"}');

    expect(result.tokensIn).toBe(100);
    expect(result.tokensOut).toBe(50);
    expect(result.costUsd).toBe(0.002);
    expect(result.finishReason).toBe('stop');
  });

  it('falls back to non-streaming when onDelta is absent', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'hi back' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const transport = new OpenAICompatTransport({
      providerName: 'test',
      model: 'test-model',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });

    const result = await transport.sendTurn({
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
    });

    expect(result.streamed).toBeUndefined();
    expect(result.message.content).toBe('hi back');
    expect(result.tokensIn).toBe(5);
    expect(result.tokensOut).toBe(2);
  });

  it('orchestrator skips double-emit when turn is streamed', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { runAgent } = await import('../orchestrator/loop.js');

    const cwd = await mkdtemp(join(tmpdir(), 'cra-stream-'));

    try {
      const chunks: string[] = [];
      const reasonings: string[] = [];

      const fakeTransport = {
        kind: 'fake-stream' as const,
        async sendTurn(req: { onDelta?: (d: { content?: string; reasoning?: string }) => void }) {
          // Simulate streaming: fire onDelta then return streamed=true
          req.onDelta?.({ reasoning: 'thinking...' });
          req.onDelta?.({ content: 'answer' });
          return {
            message: { role: 'assistant' as const, content: 'answer', tool_calls: undefined },
            tokensIn: 10,
            tokensOut: 5,
            streamed: true,
            reasoning: 'thinking...',
          };
        },
      };

      await runAgent({
        prompt: 'test',
        cwd,
        tools: [],
        transport: fakeTransport as any,
        onChunk: (c) => chunks.push(c),
        onReasoning: (r) => reasonings.push(r),
      });

      // onChunk should only be called via onDelta (the streamed content),
      // NOT a second time from the post-turn emit.
      expect(chunks).toEqual(['answer']);
      expect(reasonings).toEqual(['thinking...']);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
