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

import type { ChatMessage, ContentBlock, ToolCall } from '../transport/types.js';
import { buildEditPreview } from '../../adapters/editPreview.js';
import { DEFAULT_SYSTEM_PROMPT } from '../systemPrompt.js';
import type { AgentRunInput, AgentRunResult, AgentUsage, Tool } from '../types.js';
import { checkBudget, resolveBudget } from './budget.js';
import { parseTextualToolCalls } from './toolParse.js';
import { imageToDataUrl } from '../../context/images.js';

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const startMs = performance.now();
  const budget = resolveBudget(input.budget);

  const systemPrompt = input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  // Build the user message — multimodal when images are present.
  let userMessage: ChatMessage;
  if (input.images && input.images.length > 0) {
    const blocks: ContentBlock[] = [{ type: 'text', text: input.prompt }];
    for (const imgPath of input.images) {
      const dataUrl = imageToDataUrl(imgPath);
      if (dataUrl) {
        blocks.push({ type: 'image_url', image_url: { url: dataUrl } });
      }
    }
    userMessage = { role: 'user', content: blocks };
  } else {
    userMessage = { role: 'user', content: input.prompt };
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...(input.priorMessages ?? []),
    userMessage,
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

    // Build the onDelta bridge: content deltas -> onChunk, reasoning
    // deltas -> onReasoning. When streaming, we fire these live; the
    // post-turn emission below is then skipped (turn.streamed === true).
    const onDelta = (input.onChunk || input.onReasoning)
      ? (d: { content?: string; reasoning?: string }) => {
          if (d.content) input.onChunk?.(d.content);
          if (d.reasoning) input.onReasoning?.(d.reasoning);
        }
      : undefined;

    const turn = await input.transport.sendTurn({
      messages,
      tools: wireTools,
      reasoningEffort: input.reasoningEffort,
      signal: input.signal,
      onDelta,
    });

    usage.tokensIn += turn.tokensIn;
    usage.tokensOut += turn.tokensOut;
    usage.costUsd +=
      typeof turn.costUsd === 'number'
        ? turn.costUsd
        : (input.transport.estimateCost?.(turn.tokensIn, turn.tokensOut) ?? 0);
    input.onUsage?.({ ...usage });

    let content = typeof turn.message.content === 'string' ? turn.message.content : '';
    let toolCalls = turn.message.tool_calls ?? [];

    // Fallback for models that emit tool calls as text instead of using
    // the native `tool_calls` field (common with smaller open models on
    // OpenRouter — Qwen, Hermes, etc.). Without this the loop would see
    // no tool calls, treat the raw `<tool_call>…` text as a final answer
    // and stop mid-task. We parse the text, act on the calls, and strip
    // the block so neither the user nor the transcript sees raw markup.
    if (toolCalls.length === 0 && content) {
      const parsed = parseTextualToolCalls(content, new Set(toolByName.keys()));
      if (parsed.toolCalls.length > 0) {
        toolCalls = parsed.toolCalls;
        content = parsed.cleanedContent;
      }
    }

    if (content) {
      // Only emit the full content when the transport didn't already
      // stream it incrementally via onDelta.
      if (!turn.streamed) input.onChunk?.(content);
      fullText.push(content);
    }

    // Persist the assistant message. The OpenAI tool-call protocol
    // requires it to land BEFORE the matching `tool` messages, so we
    // push it now even if we'll exit on the next line.
    messages.push({
      role: 'assistant',
      content: content || (toolCalls.length > 0 ? null : ''),
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
    messages: messages.filter((m) => m.role !== 'system'),
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
    const preview = buildEditPreview(tc.function.name, parsedArgs);
    input.onActivity?.({
      kind: 'tool_use',
      tool: tc.function.name,
      description,
      toolUseId,
      path: preview.path,
      patch: preview.patch,
    });

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
