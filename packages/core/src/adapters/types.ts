import type { AdapterCapabilities, ProviderId } from '../types.js';

/**
 * Single observable agent action surfaced to the UI as it happens.
 *
 * Adapters that have visibility into the underlying agent's tool
 * calls (Claude Code's stream-json `tool_use` blocks, Codex's
 * `command_execution` / `file_change` items) emit one of these per
 * action. Adapters that don't (raw model APIs without a tool layer)
 * simply omit them.
 *
 * Two complementary channels:
 *   - `onChunk` carries the model's natural-language narration
 *   - `onActivity` carries the structural decisions (read X, edit Y,
 *     run shell command Z, ...) that the user wants to see in
 *     real time, separate from the prose
 *
 * The REPL renders activity events as a rolling gray-italic feed
 * below the streaming text, mirroring Claude Code's own UX.
 */
export type ActivityEvent =
  /**
   * Agent decided to invoke a tool. `tool` is the canonical tool
   * name (Read/Edit/Write/Bash/Grep/Glob/Task/...); `description`
   * is a one-line, human-readable summary suitable for the REPL
   * (e.g. `read packages/foo.ts`, `bash: git status`,
   * `edit src/bar.ts (3 lines)`).
   *
   * `toolUseId` is the agent's per-call id when available - the
   * matching `tool_result` carries the same id so the UI can pair
   * them if it wants.
   */
  | {
      kind: 'tool_use';
      tool: string;
      description: string;
      toolUseId?: string;
      raw?: unknown;
    }
  /**
   * Tool finished. `ok=false` means the tool itself errored (e.g.
   * the bash command exited non-zero, the file path didn't exist),
   * not that the run failed.
   *
   * `body` is the captured multi-line output of the tool (bash
   * stdout/stderr, search results, error message, ...). Adapters
   * SHOULD send the full content; the UI is responsible for
   * truncating to fit on screen. Adapters MAY omit it for tools
   * whose result is structurally uninteresting (e.g. a Read tool
   * that just confirms it loaded a file).
   */
  | { kind: 'tool_result'; tool: string; ok: boolean; body?: string; toolUseId?: string }
  /**
   * Reasoning / thinking summary. Codex emits these between agent
   * messages; Claude Code rarely surfaces them directly. Optional -
   * the REPL may dim or hide them entirely depending on verbosity.
   */
  | { kind: 'thinking'; text: string };

export type AdapterCallInput = {
  prompt: string;
  systemPrompt?: string;
  cwd?: string;
  maxTokens?: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  transformer?: string[];
  files?: string[];
  contextManifest?: import('../types.js').ContextManifest;
  signal?: AbortSignal;
  /**
   * Optional callback invoked with each output chunk as it streams in.
   * Adapters that don't support streaming (e.g. one-shot HTTP calls
   * without SSE) MAY simply emit the full result at the end. The UI
   * accumulates these into its scrollback buffer so the user sees
   * partial output instead of a sudden dump at completion.
   */
  onChunk?: (chunk: string) => void;
  /**
   * Optional structured-action sink. Called once per observable
   * tool_use/tool_result/thinking event for adapters that have
   * access to that information; never called for adapters that
   * don't. See the {@link ActivityEvent} doc for the channel
   * contract.
   */
  onActivity?: (event: ActivityEvent) => void;
};

export type AdapterCallResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
  filesChanged?: string[];
  raw?: unknown;
};

export type Adapter = {
  id: ProviderId;
  name: string;
  capabilities: AdapterCapabilities;
  run: (input: AdapterCallInput) => Promise<AdapterCallResult>;
  plan?: (input: AdapterCallInput) => Promise<AdapterCallResult>;
  score?: (input: AdapterCallInput) => Promise<number>;
  estimateCost: (tokensIn: number, tokensOut: number) => number;
};
