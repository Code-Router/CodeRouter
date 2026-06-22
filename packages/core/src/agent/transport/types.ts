/**
 * Transport interface: how the agent loop talks to a chat model.
 *
 * Every concrete transport sends a `ChatTurnRequest` and returns a
 * `ChatTurnResponse`. The wire format mirrors OpenAI's tool-calling
 * shape because OpenRouter, OpenAI direct, Groq, DeepSeek,
 * Together, Fireworks and Mistral all speak it natively.
 *
 * Adding a new transport (Anthropic native messages, streaming,
 * function-calling-over-WebSocket, ...) is a matter of implementing
 * this interface; the orchestrator stays untouched.
 */

import type { JsonSchema } from '../types.js';

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCall[];
    }
  | {
      role: 'tool';
      tool_call_id: string;
      content: string;
    };

export type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type WireTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

export type ChatTurnRequest = {
  messages: ChatMessage[];
  tools: WireTool[];
  /** OpenAI-style reasoning effort param. */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  signal?: AbortSignal;
  /**
   * When set, the transport SHOULD stream the response and invoke
   * this callback with incremental text deltas as they arrive.
   * `content` carries answer text; `reasoning` carries chain-of-
   * thought (shown dimmed in the REPL). Transports that don't
   * support streaming simply ignore this and emit nothing.
   */
  onDelta?: (delta: { content?: string; reasoning?: string }) => void;
};

export type ChatTurnResponse = {
  /** The assistant message produced this turn (verbatim). */
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: ToolCall[];
  };
  /** Token counts for this turn (NOT cumulative; loop sums across turns). */
  tokensIn: number;
  tokensOut: number;
  /**
   * Actual USD cost for this turn as reported by the backend (e.g.
   * OpenRouter's `usage.cost`). Undefined when the backend doesn't
   * surface a real figure; the loop then falls back to
   * `estimateCost()`. NOT cumulative.
   */
  costUsd?: number;
  /** Optional finish reason from the backend (`stop`, `tool_calls`, ...). */
  finishReason?: string;
  /**
   * True when the transport already streamed content/reasoning via
   * `onDelta` during the request. The orchestrator uses this to
   * avoid double-emitting the answer through `onChunk`.
   */
  streamed?: boolean;
  /** Full reasoning text for this turn (if the model produced it). */
  reasoning?: string;
};

/**
 * The minimum interface a transport must implement. Stateless from
 * the caller's perspective: each call carries its own messages
 * array.
 */
export type ChatTransport = {
  /**
   * Stable identifier - shows up in logs / activity for "which
   * transport produced this turn". Free-form (e.g. "openai-compat",
   * "anthropic-native").
   */
  readonly kind: string;

  /** Send a single tool-call-aware chat turn. */
  sendTurn(req: ChatTurnRequest): Promise<ChatTurnResponse>;

  /**
   * Optional hint for cost accounting. Returns USD given input +
   * output token counts. The orchestrator falls back to 0 when the
   * transport doesn't model pricing.
   */
  estimateCost?(tokensIn: number, tokensOut: number): number;
};
