/**
 * Tests for the agent orchestrator (`runAgent`).
 *
 * Uses a `FakeTransport` instead of a real HTTP backend so we can
 * script the model's response sequence and assert the loop's
 * book-keeping (message history shape, tool dispatch, budget caps,
 * usage accumulation, abort handling, ask_user_question
 * short-circuit).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAgent } from '../orchestrator/loop.js';
import { defaultTools, withTool, withoutTool } from '../tools/index.js';
import type {
  ChatTransport,
  ChatTurnRequest,
  ChatTurnResponse,
  Tool,
  ToolCall,
} from '../types.js';

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'cra-orch-'));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

class FakeTransport implements ChatTransport {
  readonly kind = 'fake';
  public sent: ChatTurnRequest[] = [];
  constructor(private readonly turns: ChatTurnResponse[]) {}
  async sendTurn(req: ChatTurnRequest): Promise<ChatTurnResponse> {
    this.sent.push(req);
    const next = this.turns.shift();
    if (!next) throw new Error('FakeTransport: ran out of scripted turns');
    return next;
  }
  estimateCost(tokensIn: number, tokensOut: number): number {
    return (tokensIn + tokensOut) / 1_000_000;
  }
}

function tc(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

describe('runAgent', () => {
  it('exits cleanly when the model returns no tool_calls', async () => {
    const transport = new FakeTransport([
      {
        message: { role: 'assistant', content: 'all done' },
        tokensIn: 10,
        tokensOut: 3,
      },
    ]);
    const result = await runAgent({
      prompt: 'do nothing',
      cwd,
      tools: defaultTools(),
      transport,
    });
    expect(result.text).toBe('all done');
    expect(result.iterations).toBe(1);
    expect(result.finishReason).toBe('done');
    expect(result.tokensIn).toBe(10);
    expect(result.tokensOut).toBe(3);
    expect(result.costUsd).toBeCloseTo(13 / 1_000_000);
  });

  it('round-trips a tool call and feeds the result back to the model', async () => {
    const echoTool: Tool = {
      name: 'echo',
      description: 'echo',
      parameters: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
      describe: () => 'echo',
      run: async (args) => ({ body: `echoed:${String(args.msg)}` }),
    };
    const transport = new FakeTransport([
      {
        message: {
          role: 'assistant',
          content: 'calling',
          tool_calls: [tc('1', 'echo', { msg: 'hi' })],
        },
        tokensIn: 5,
        tokensOut: 2,
      },
      {
        message: { role: 'assistant', content: 'finished' },
        tokensIn: 8,
        tokensOut: 1,
      },
    ]);
    const activity: string[] = [];
    const result = await runAgent({
      prompt: 'echo hi',
      cwd,
      tools: [echoTool],
      transport,
      onActivity: (e) => activity.push(`${e.kind}:${e.tool ?? '-'}`),
    });
    expect(result.iterations).toBe(2);
    expect(result.finishReason).toBe('done');
    // Second turn must include the tool result message.
    const secondMessages = transport.sent[1]!.messages;
    const toolMsg = secondMessages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe('echoed:hi');
    expect(activity).toContain('tool_use:echo');
    expect(activity).toContain('tool_result:echo');
  });

  it('acts on a tool call emitted as text instead of native tool_calls', async () => {
    const echoTool: Tool = {
      name: 'echo',
      description: 'echo',
      parameters: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
      describe: () => 'echo',
      run: async (args) => ({ body: `echoed:${String(args.msg)}` }),
    };
    // First turn: the model prints a Qwen-style textual tool call with no
    // native tool_calls. The loop must parse it, run the tool, and keep going.
    const transport = new FakeTransport([
      {
        message: {
          role: 'assistant',
          content:
            'let me echo\n<tool_call>\n<function=echo>\n<parameter=msg>\nhi\n</parameter>\n</function>\n</tool_call>',
        },
        tokensIn: 5,
        tokensOut: 2,
      },
      {
        message: { role: 'assistant', content: 'done' },
        tokensIn: 3,
        tokensOut: 1,
      },
    ]);
    const result = await runAgent({ prompt: 'echo hi', cwd, tools: [echoTool], transport });
    expect(result.iterations).toBe(2);
    expect(result.finishReason).toBe('done');
    // Tool ran and its result was fed back to the model.
    const toolMsg = transport.sent[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe('echoed:hi');
    // The raw <tool_call> markup is stripped from the assistant turn.
    const assistantMsg = transport.sent[1]!.messages.find(
      (m) => m.role === 'assistant' && m.tool_calls,
    );
    expect(assistantMsg?.content).toBe('let me echo');
    expect(result.text).not.toContain('<tool_call>');
  });

  it('reports the tool error back to the model rather than throwing', async () => {
    const failingTool: Tool = {
      name: 'fail',
      description: '',
      parameters: { type: 'object', properties: {} },
      describe: () => 'fail',
      run: async () => {
        throw new Error('boom');
      },
    };
    const transport = new FakeTransport([
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [tc('1', 'fail', {})],
        },
        tokensIn: 1,
        tokensOut: 1,
      },
      {
        message: { role: 'assistant', content: 'ok recovered' },
        tokensIn: 1,
        tokensOut: 1,
      },
    ]);
    const result = await runAgent({
      prompt: 'go',
      cwd,
      tools: [failingTool],
      transport,
    });
    expect(result.text).toBe('ok recovered');
    const toolMsg = transport.sent[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('boom');
  });

  it('handles unknown tool names without crashing the loop', async () => {
    const transport = new FakeTransport([
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [tc('1', 'mystery', {})],
        },
        tokensIn: 1,
        tokensOut: 1,
      },
      {
        message: { role: 'assistant', content: 'recovered' },
        tokensIn: 1,
        tokensOut: 1,
      },
    ]);
    const result = await runAgent({
      prompt: 'go',
      cwd,
      tools: [],
      transport,
    });
    expect(result.text).toBe('recovered');
    const toolMsg = transport.sent[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain("unknown tool 'mystery'");
  });

  it('hits the iteration cap', async () => {
    const loopTool: Tool = {
      name: 'tick',
      description: 'tick',
      parameters: { type: 'object', properties: {} },
      describe: () => 'tick',
      run: async () => ({ body: 'tick' }),
    };
    const turns = Array.from({ length: 10 }, (_, i) => ({
      message: {
        role: 'assistant' as const,
        content: null,
        tool_calls: [tc(`${i}`, 'tick', {})],
      },
      tokensIn: 1,
      tokensOut: 1,
    }));
    const transport = new FakeTransport(turns);
    const result = await runAgent({
      prompt: 'loop forever',
      cwd,
      tools: [loopTool],
      transport,
      budget: { maxIterations: 3 },
    });
    expect(result.iterations).toBe(3);
    expect(result.finishReason).toBe('iteration-cap');
  });

  it('honours an external AbortSignal', async () => {
    const ctl = new AbortController();
    const transport = new FakeTransport([
      {
        message: { role: 'assistant', content: 'hi' },
        tokensIn: 1,
        tokensOut: 1,
      },
    ]);
    ctl.abort();
    const result = await runAgent({
      prompt: 'go',
      cwd,
      tools: [],
      transport,
      signal: ctl.signal,
    });
    expect(result.finishReason).toBe('aborted');
    expect(result.iterations).toBe(0);
  });

  it('short-circuits when ask_user_question fires', async () => {
    const transport = new FakeTransport([
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            tc('1', 'ask_user_question', {
              questions: [{ question: 'Which approach?', options: [{ label: 'A' }] }],
            }),
          ],
        },
        tokensIn: 1,
        tokensOut: 1,
      },
    ]);
    const captured: unknown[] = [];
    const result = await runAgent({
      prompt: 'go',
      cwd,
      tools: defaultTools(),
      transport,
      onUserQuestion: (p) => captured.push(p),
    });
    expect(result.finishReason).toBe('user-question');
    expect(captured).toHaveLength(1);
  });

  it('streams onChunk with assistant content', async () => {
    const transport = new FakeTransport([
      {
        message: { role: 'assistant', content: 'partial result' },
        tokensIn: 1,
        tokensOut: 1,
      },
    ]);
    const chunks: string[] = [];
    await runAgent({
      prompt: 'go',
      cwd,
      tools: [],
      transport,
      onChunk: (c) => chunks.push(c),
    });
    expect(chunks).toEqual(['partial result']);
  });
});

describe('tool registry helpers (smoke)', () => {
  it('defaultTools is mutable via withTool/withoutTool', () => {
    const dropped = withoutTool(defaultTools(), 'bash');
    expect(dropped.find((t) => t.name === 'bash')).toBeUndefined();
    const replaced = withTool(dropped, {
      name: 'bash',
      description: 'safer',
      parameters: { type: 'object', properties: {} },
      describe: () => 'bash',
      run: async () => ({ body: 'noop' }),
    });
    expect(replaced.find((t) => t.name === 'bash')?.description).toBe('safer');
  });
});
