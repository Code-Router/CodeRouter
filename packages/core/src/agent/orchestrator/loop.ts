/**
 * The agent loop.
 *
 * Pipeline (one iteration):
 *
 *   checkBudget() -> transport.sendTurn() -> emit chunk + activity
 *   -> for each tool_call: tool.run() in worktree -> append `tool` message
 *   -> back to top
 *
 * Exits when:
 *   - the assistant returns no tool_calls (final answer)
 *   - the model invokes ask_user_question (REPL takes over)
 *   - the budget is exhausted (iterations or wall-clock)
 *   - the caller's AbortSignal fires
 *
 * Stays small on purpose. Iteration-friendly extension points are:
 *   - `transport`     swap to add streaming, anthropic-native, etc.
 *   - `tools`         add/remove/replace via the tools/ module
 *   - `systemPrompt`  per-task variants from systemPrompt.ts
 *   - `budget`        tweak per-route caps
 */

import type { ChatMessage, ToolCall } from '../transport/types.js';
import { DEFAULT_SYSTEM_PROMPT } from '../systemPrompt.js';
import type { AgentRunInput, AgentRunResult, AgentUsage, Tool } from '../types.js';
import { checkBudget, resolveBudget } from './budget.js';

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const startMs = performance.now();
  const budget = resolveBudget(input.budget);

  const systemPrompt = input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: input.prompt },
  ];

  const wireTools = input.tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
  const toolByName = new Map<string, Tool>(input.tools.map((t) => [t.name, t]));

  const usage: AgentUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const fullText: string[] = [];
  let iterations = 0;
  let finishReason: AgentRunResult['finishReason'] = 'done';

  while (true) {
    const stop = checkBudget({
      iteration: iterations,
      startMs,
      budget,
      signal: input.signal,
    });
    if (stop) {
      finishReason = stop;
      break;
    }

    iterations++;
    const turn = await input.transport.sendTurn({
      messages,
      tools: wireTools,
      reasoningEffort: input.reasoningEffort,
      signal: input.signal,
    });

    usage.tokensIn += turn.tokensIn;
    usage.tokensOut += turn.tokensOut;
    // Prefer the backend's real cost (e.g. OpenRouter's usage.cost) when
    // it reports one; fall back to the transport's list-price estimate.
    usage.costUsd +=
      typeof turn.costUsd === 'number'
        ? turn.costUsd
        : (input.transport.estimateCost?.(turn.tokensIn, turn.tokensOut) ?? 0);
    input.onUsage?.({ ...usage });

    const content = typeof turn.message.content === 'string' ? turn.message.content : '';
    if (content) {
      input.onChunk?.(content);
      fullText.push(content);
    }

    const toolCalls = turn.message.tool_calls ?? [];

    // Persist the assistant message verbatim. The OpenAI tool-call
    // protocol requires it to land BEFORE the matching `tool`
    // messages, so we push it now even if we'll exit on the next
    // line.
    messages.push({
      role: 'assistant',
      content: turn.message.content ?? null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    if (toolCalls.length === 0) break;

    const askedQuestion = await executeToolCalls({
      toolCalls,
      toolByName,
      messages,
      input,
    });
    if (askedQuestion) {
      finishReason = 'user-question';
      break;
    }
  }

  return {
    text: fullText.join('\n\n'),
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    costUsd: usage.costUsd,
    durationMs: performance.now() - startMs,
    iterations,
    finishReason,
  };
}

/**
 * Run every tool call from one assistant turn. Each call MUST get
 * a matching `tool` message appended to `messages` before we send
 * the next turn, otherwise the OpenAI tool-call protocol breaks.
 *
 * Returns true if any tool was `ask_user_question` (the loop
 * short-circuits in that case so the REPL can take over).
 */
async function executeToolCalls(opts: {
  toolCalls: ToolCall[];
  toolByName: Map<string, Tool>;
  messages: ChatMessage[];
  input: AgentRunInput;
}): Promise<boolean> {
  let askedQuestion = false;
  const { toolCalls, toolByName, messages, input } = opts;

  for (const tc of toolCalls) {
    if (input.signal?.aborted) break;

    const tool = toolByName.get(tc.function.name);
    const toolUseId = tc.id;
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch (err) {
      const errBody = `error parsing arguments: ${(err as Error).message}`;
      messages.push({ role: 'tool', tool_call_id: tc.id, content: errBody });
      input.onActivity?.({
        kind: 'tool_use',
        tool: tc.function.name,
        description: tc.function.name,
        toolUseId,
      });
      input.onActivity?.({
        kind: 'tool_result',
        tool: tc.function.name,
        ok: false,
        body: errBody,
        toolUseId,
      });
      continue;
    }

    const description = tool ? safeDescribe(tool, parsedArgs) : tc.function.name;
    input.onActivity?.({ kind: 'tool_use', tool: tc.function.name, description, toolUseId });

    if (!tool) {
      const errBody = `unknown tool '${tc.function.name}'`;
      messages.push({ role: 'tool', tool_call_id: tc.id, content: errBody });
      input.onActivity?.({
        kind: 'tool_result',
        tool: tc.function.name,
        ok: false,
        body: errBody,
        toolUseId,
      });
      continue;
    }

    try {
      const result = await tool.run(parsedArgs, {
        cwd: input.cwd,
        signal: input.signal,
        onUserQuestion: input.onUserQuestion
          ? (payload) => {
              askedQuestion = true;
              input.onUserQuestion?.(payload);
            }
          : undefined,
      });
      const ok = result.ok ?? true;
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result.body });
      input.onActivity?.({
        kind: 'tool_result',
        tool: tc.function.name,
        ok,
        body: result.display ?? result.body,
        toolUseId,
      });
    } catch (err) {
      const errBody = `error: ${(err as Error).message}`;
      messages.push({ role: 'tool', tool_call_id: tc.id, content: errBody });
      input.onActivity?.({
        kind: 'tool_result',
        tool: tc.function.name,
        ok: false,
        body: errBody,
        toolUseId,
      });
    }
  }

  return askedQuestion;
}

function safeDescribe(tool: Tool, args: Record<string, unknown>): string {
  try {
    return tool.describe(args);
  } catch {
    return tool.name;
  }
}
