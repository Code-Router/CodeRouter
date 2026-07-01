/**
 * Public types for the CodeRouter coding-agent module.
 *
 * Layered:
 *   - Tool layer:      Tool, ToolContext, ToolResult, JsonSchema
 *   - Wire layer:      ChatMessage, ToolCall, WireTool, ChatTurn
 *                      (re-exported from `./transport/types.ts`)
 *   - Orchestrator:    AgentRunInput, AgentRunResult, AgentBudget
 *
 * The boundary that matters most for downstream callers:
 *   `runAgent(input)` is the only entry point you need. Everything
 *   else (transports, tools, prompt, budget) is composable so the
 *   adapter can wire in a custom set without forking the loop.
 */

import type { ActivityEvent, AskUserQuestionPayload } from '../adapters/types.js';
import type { ChatMessage, ChatTransport } from './transport/types.js';

// ----- tool layer -------------------------------------------------------

export type Tool = {
  /** Tool name as the model sees it. snake_case. */
  name: string;
  /** Plain-language description shown to the model. */
  description: string;
  /** JSON Schema for `arguments`. */
  parameters: JsonSchema;
  /** One-line label for the activity feed. Called BEFORE `run`. */
  describe: (args: ToolArgs) => string;
  /** Execute the tool inside the worktree. */
  run: (args: ToolArgs, ctx: ToolContext) => Promise<ToolResult>;
};

export type ToolArgs = Record<string, unknown>;

export type ToolContext = {
  /** Working directory (worktree root). All paths resolve relative to this. */
  cwd: string;
  /** Cooperative cancellation. Long-running tools MUST honour this. */
  signal?: AbortSignal;
  /**
   * Forwarded `onUserQuestion` so the special-cased
   * `ask_user_question` tool can hand the structured payload to the
   * REPL the same way Claude Code's `AskUserQuestion` does.
   */
  onUserQuestion?: (payload: AskUserQuestionPayload) => void;
  /**
   * How the agent may run shell commands. The `bash` tool consults this
   * to gate commands under `allowlist` mode. Unset / `sandboxed` /
   * `unsandboxed` impose no per-command gating.
   */
  runMode?: import('../modes/types.js').RunMode;
  /**
   * Structured-action sink, forwarded from the run. Lets tools surface
   * events beyond their return value - e.g. `bash` emitting a
   * `process_started` event for a backgrounded dev server so the UI can
   * track and preview it.
   */
  onActivity?: (event: ActivityEvent) => void;
};

export type ToolResult = {
  /** Body sent back to the model as the `tool` message content. */
  body: string;
  /** Optional shorter version for the activity feed. Defaults to `body`. */
  display?: string;
  /** Whether the tool succeeded. Defaults to true. */
  ok?: boolean;
};

export type JsonSchema = {
  type: 'object';
  properties: Record<string, JsonSchemaProp>;
  required?: string[];
  additionalProperties?: boolean;
};

export type JsonSchemaProp = {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: JsonSchemaProp;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
  default?: unknown;
};

// ----- orchestrator layer -----------------------------------------------

export type AgentBudget = {
  /** Hard cap on the number of model<->tool round trips. */
  maxIterations: number;
  /** Wall-clock cap (ms). Loop exits cleanly when exceeded. */
  maxDurationMs: number;
  /** Per-HTTP-call timeout (ms) for the chat/completions request. */
  perCallTimeoutMs: number;
};

export type AgentUsage = {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

export type AgentRunInput = {
  prompt: string;
  systemPrompt?: string;
  cwd: string;
  signal?: AbortSignal;

  /** Tools available to the model this turn. */
  tools: Tool[];

  /**
   * The transport that talks to the LLM. Plug in `openaiCompat` for
   * OpenRouter / OpenAI / Groq / DeepSeek / Together / Fireworks /
   * Mistral. Easy to swap for an Anthropic-native or streaming
   * variant later.
   */
  transport: ChatTransport;

  /** UI streaming callbacks (forwarded into the loop's emissions). */
  onChunk?: (chunk: string) => void;
  /** Called with incremental reasoning/thinking text deltas. */
  onReasoning?: (chunk: string) => void;
  onActivity?: (e: ActivityEvent) => void;
  onUsage?: (u: AgentUsage) => void;
  onUserQuestion?: (payload: AskUserQuestionPayload) => void;

  /** Prior conversation messages to prepend (after system, before this turn's user prompt). */
  priorMessages?: ChatMessage[];

  /**
   * How the agent may run shell commands (forwarded into each tool's
   * context). Gates the `bash` tool under `allowlist` mode.
   */
  runMode?: import('../modes/types.js').RunMode;

  /** Absolute paths to image files to include in the user message as vision content. */
  images?: string[];

  /** Optional budget overrides; defaults are conservative. */
  budget?: Partial<AgentBudget>;

  /** OpenAI-style optional reasoning effort param. */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
};

export type AgentRunResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
  iterations: number;
  /** Why the loop exited - useful for telemetry. */
  finishReason: 'done' | 'iteration-cap' | 'duration-cap' | 'aborted' | 'user-question';
  /** Full message history from this turn (system excluded) for conversation persistence. */
  messages: ChatMessage[];
};

// ----- transport (re-exported) -----------------------------------------

export type {
  ChatTransport,
  ChatTurnRequest,
  ChatTurnResponse,
  ChatMessage,
  ToolCall,
  WireTool,
} from './transport/types.js';
