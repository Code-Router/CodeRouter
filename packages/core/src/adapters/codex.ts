import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AdapterCapabilities, ProviderId } from '../types.js';
import { exec } from '../sandbox/exec.js';
import { BaseAdapter } from './base.js';
import type {
  ActivityEvent,
  AdapterCallInput,
  AdapterCallResult,
} from './types.js';

type CodexAuthMode = 'chatgpt' | 'apikey' | 'unknown';

/**
 * Sniff `~/.codex/auth.json` to see whether `codex` is signed in via a
 * ChatGPT account or via a raw OpenAI API key. The Codex CLI only
 * accepts arbitrary `-m <model>` arguments when authed by API key;
 * ChatGPT-account auth restricts model selection to whatever the
 * user's subscription tier allows and 400s with
 *   "The '<model>' model is not supported when using Codex with a
 *    ChatGPT account."
 * if we try to override.
 *
 * Done sync at construction time so we don't add a subprocess on
 * every route. The detection is cheap (one tiny file read) and the
 * answer can't change without the user re-logging in.
 */
export function detectCodexAuthMode(): CodexAuthMode {
  const path = process.env.CODEX_HOME
    ? join(process.env.CODEX_HOME, 'auth.json')
    : join(homedir(), '.codex', 'auth.json');
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      auth_mode?: string;
      OPENAI_API_KEY?: string | null;
    };
    if (parsed.auth_mode === 'chatgpt') return 'chatgpt';
    if (parsed.auth_mode === 'apikey') return 'apikey';
    // Older codex versions skipped `auth_mode`; fall back to checking
    // whether an OPENAI_API_KEY is literally present in the file.
    if (typeof parsed.OPENAI_API_KEY === 'string' && parsed.OPENAI_API_KEY.length > 0) {
      return 'apikey';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export type CodexAdapterOptions = {
  /** Path to the codex binary. Defaults to `codex` on PATH. */
  bin?: string;
  /** Codex model selector, e.g. 'gpt-5-codex'. */
  model?: string;
  /** Additional CLI args appended to every call. */
  extraArgs?: string[];
  /**
   * Codex sandbox policy. Defaults to `workspace-write` because the
   * adapter always runs inside a CodeRouter-managed git worktree
   * (`.coderouter/runs/<id>/`) which is already isolated from the
   * host repo - blocking writes there would just cause the model to
   * stall with "please approve" messages on routine code-edit tasks.
   * Override to `read-only` if you want stricter guarantees, or
   * `danger-full-access` if you trust the model enough to let it
   * touch the wider filesystem.
   */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /**
   * Approval policy override. Defaults to `never` because the
   * non-interactive `codex exec --json` invocation has no channel
   * to surface an approval prompt to the user - codex would just
   * emit a "please approve" agent_message and give up. With
   * sandbox=workspace-write, in-worktree edits are allowed without
   * approval; out-of-sandbox actions still fail.
   */
  approval?: 'never' | 'on-failure' | 'untrusted' | 'on-request';
  timeoutMs?: number;
  /** Price per 1M tokens (Codex API). */
  pricePer1MIn?: number;
  pricePer1MOut?: number;
};

/**
 * Codex CLI adapter. Spawns `codex exec` inside the target cwd.
 *
 * Codex writes its diffs directly to disk; we sandbox by giving it a
 * worktree-rooted cwd. Token counts and cost come from the JSON output;
 * if not available we fall back to a coarse estimate based on prompt
 * length, which is honest for the eval harness (we record what we
 * actually measured).
 */
export class CodexAdapter extends BaseAdapter {
  id: ProviderId = 'codex';
  name = 'Codex CLI';
  capabilities: AdapterCapabilities;

  constructor(public readonly opts: CodexAdapterOptions = {}) {
    super();
    this.capabilities = {
      canEdit: true,
      canPlan: true,
      longContext: false,
      reasoning: true,
      tools: true,
      streaming: true,
      vision: false,
      pricePer1MIn: opts.pricePer1MIn ?? 3,
      pricePer1MOut: opts.pricePer1MOut ?? 15,
      contextWindow: 400_000,
      family: 'shell-agent',
    };
  }

  override async run(input: AdapterCallInput): Promise<AdapterCallResult> {
    if (!input.cwd) throw new Error('CodexAdapter requires `cwd` (a worktree path)');

    // We always run with `--json`. Two reasons:
    //   1. In plain-text mode codex block-buffers its stdout when not
    //      attached to a TTY, so `child.stdout.on('data')` only fires
    //      once - at process exit - and the REPL loses any chance of
    //      streaming the response. `--json` flushes per event, which
    //      gives us a proper token-level stream to forward to the UI.
    //   2. JSONL is also a more robust parsing target for token
    //      counts, status, and the final answer text than scraping
    //      whatever ANSI-flavoured text codex would otherwise emit.
    const args: string[] = ['exec', '--json'];
    // Only pass `-m` when Codex is API-key authed - ChatGPT-account
    // installs reject any model we'd pass (the CLI picks one based on
    // the user's plan instead).
    const authMode = detectCodexAuthMode();
    if (this.opts.model && authMode === 'apikey') {
      args.push('-m', this.opts.model);
    }
    // Sandbox + approval policy. We default to workspace-write +
    // approval=never so codex can edit files inside our worktree
    // without stalling for an interactive prompt that --json can't
    // deliver. Both are overridable per-instance via opts.
    // `input.readOnly` (plan / review modes running in the user's
    // real cwd) hard-overrides to read-only regardless of opts.
    const sandbox = input.readOnly ? 'read-only' : (this.opts.sandbox ?? 'workspace-write');
    args.push('-s', sandbox);
    const approval = this.opts.approval ?? 'never';
    // Newer codex versions expose approval policy only through the
    // `-c` config override (the `-a` short flag was removed); the
    // `-c approval_policy=` form works in both old and current
    // releases, so we use it unconditionally.
    args.push('-c', `approval_policy="${approval}"`);
    if (this.opts.extraArgs) args.push(...this.opts.extraArgs);
    args.push('--', input.prompt);

    const parser = new CodexJsonStream({
      onChunk: input.onChunk,
      onActivity: input.onActivity,
      onUsage: input.onUsage,
      estimateCost: (i: number, o: number) => this.estimateCost(i, o),
      // Rough prompt-token estimate so the live counter shows a
      // meaningful "<N> in" the moment the run starts, before
      // codex's authoritative numbers arrive at turn.completed.
      // ~4 chars per token is OpenAI's published rule of thumb.
      promptTokenEstimate: Math.max(1, Math.ceil(input.prompt.length / 4)),
    });

    const res = await exec(this.opts.bin ?? 'codex', args, {
      cwd: input.cwd,
      timeoutMs: this.opts.timeoutMs ?? 600_000,
      signal: input.signal,
      onStdout: (chunk: string) => parser.push(chunk),
    });
    parser.flush();

    if (res.exitCode !== 0) {
      // Try to surface the actual API error message when codex emits one
      // (it usually goes to stderr as JSON). Falls back to the raw blob
      // when we can't recognise the shape.
      const hint = parseCodexErrorHint(res.stderr) ?? parser.lastError ?? '';
      const detail = hint || `stdout: ${res.stdout.slice(-1000)}\nstderr: ${res.stderr.slice(-1000)}`;
      throw new Error(`CodexAdapter: codex exit ${res.exitCode}\n${detail}`);
    }

    const text = parser.finalText();
    // Prefer codex's own usage numbers (emitted in turn.completed) when
    // available, fall back to a length-based heuristic otherwise so the
    // report layer always has *some* number to display.
    const tokensIn = parser.usage.input_tokens ?? Math.ceil(input.prompt.length / 4);
    const tokensOut = parser.usage.output_tokens ?? Math.ceil(text.length / 4);

    return {
      text,
      tokensIn,
      tokensOut,
      costUsd: this.estimateCost(tokensIn, tokensOut),
      durationMs: res.durationMs,
      raw: { stdout: res.stdout, stderr: res.stderr, events: parser.eventCount },
    };
  }
}

type CodexUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
};

type CodexItem = {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  status?: string;
  // file_change items
  path?: string;
  changes?: Array<{ path?: string; type?: string }>;
  // tool_call items (older codex builds)
  name?: string;
  args?: Record<string, unknown>;
  // reasoning items
  summary?: string;
};

type CodexEvent = {
  type?: string;
  item?: CodexItem;
  usage?: CodexUsage;
  message?: string;
  error?: { message?: string };
};

/**
 * Stateful JSONL parser for `codex exec --json`.
 *
 * codex emits one event per line. For agent_message items it sends a
 * lifecycle of `item.started` → repeated `item.updated` → `item.completed`,
 * each carrying the cumulative `text` field, so we forward only the
 * incremental delta to the UI on every update. Other item types
 * (reasoning, command_execution, file_change, tool calls) are dropped
 * from the streaming surface - they're noisy and the REPL already
 * shows the model's natural-language narration through agent_message.
 *
 * The parser is tolerant of mid-line chunk boundaries and skips any
 * non-JSON output silently so that a stray banner or panic line
 * doesn't break the run.
 */
class CodexJsonStream {
  private buffer = '';
  private agentTexts = new Map<string, string>();
  private agentOrder: string[] = [];
  /** Items we've already emitted a `tool_use` for, keyed by item id. */
  private startedTools = new Set<string>();
  usage: CodexUsage = {};
  eventCount = 0;
  lastError: string | null = null;
  /**
   * Total streamed text so we can fire estimate-based usage updates
   * before turn.completed arrives - Codex doesn't report usage
   * mid-turn, so without this the live token counter would sit at 0
   * for the entire run and only jump to the real value at the end.
   */
  private streamedTextLen = 0;
  /** Last time we estimated usage; throttle to avoid spamming. */
  private lastEstimateAt = 0;
  /**
   * Approximate input-token count for the prompt. Filled from the
   * adapter so we can show "<promptTokens> in · <streamed/4> out"
   * almost immediately, even before any model output arrives.
   */
  private promptTokenEstimate = 0;

  constructor(
    private readonly opts: {
      onChunk?: (s: string) => void;
      onActivity?: (e: ActivityEvent) => void;
      onUsage?: (u: { tokensIn: number; tokensOut: number; costUsd: number }) => void;
      estimateCost?: (tokensIn: number, tokensOut: number) => number;
      promptTokenEstimate?: number;
    },
  ) {
    this.promptTokenEstimate = opts.promptTokenEstimate ?? 0;
    if (this.promptTokenEstimate > 0) {
      // Fire once up front so the spinner immediately shows
      // "<N> in · 0 out · …" instead of an empty token segment.
      this.opts.onUsage?.({
        tokensIn: this.promptTokenEstimate,
        tokensOut: 0,
        costUsd: 0,
      });
    }
  }

  /**
   * Push a streaming-time usage estimate to the UI based on the
   * cumulative output text length (~4 chars per token, the OpenAI
   * rule of thumb). Throttled to ~250ms so we don't drown React
   * in re-renders. Replaced wholesale by the real numbers the moment
   * `turn.completed` arrives.
   */
  private maybeEmitEstimate(): void {
    if (!this.opts.onUsage) return;
    const now = Date.now();
    if (now - this.lastEstimateAt < 250) return;
    this.lastEstimateAt = now;
    const tokensOut = Math.max(0, Math.round(this.streamedTextLen / 4));
    const tokensIn = this.promptTokenEstimate || (this.usage.input_tokens ?? 0);
    this.opts.onUsage({
      tokensIn,
      tokensOut,
      costUsd: this.opts.estimateCost?.(tokensIn, tokensOut) ?? 0,
    });
  }

  push(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      this.handleLine(line);
    }
  }

  /** Drain any trailing line that didn't end with a newline. */
  flush(): void {
    if (this.buffer.trim().length > 0) {
      this.handleLine(this.buffer);
      this.buffer = '';
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let ev: CodexEvent;
    try {
      ev = JSON.parse(trimmed) as CodexEvent;
    } catch {
      return;
    }
    this.eventCount += 1;
    switch (ev.type) {
      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const item = ev.item;
        if (!item) return;
        // Agent messages are streamed as text; everything else is
        // surfaced as a structured activity event for the REPL feed.
        if (item.type === 'agent_message' && item.id) {
          const text = item.text ?? '';
          const isNew = !this.agentTexts.has(item.id);
          const prev = this.agentTexts.get(item.id) ?? '';
          if (isNew) {
            this.agentTexts.set(item.id, '');
            this.agentOrder.push(item.id);
            if (this.agentOrder.length > 1) this.opts.onChunk?.('\n\n');
          }
          if (text.length > prev.length) {
            const delta = text.slice(prev.length);
            this.agentTexts.set(item.id, text);
            this.streamedTextLen += delta.length;
            this.opts.onChunk?.(delta);
            this.maybeEmitEstimate();
          } else if (text.length < prev.length) {
            this.agentTexts.set(item.id, text);
          }
          return;
        }
        this.handleStructuredItem(ev.type, item);
        return;
      }
      case 'turn.completed':
        if (ev.usage) {
          this.usage = ev.usage;
          // codex doesn't surface its own cost number, so we lean
          // on the adapter's per-token estimator for the live
          // counter. The eval harness still records what we
          // measured, not what we estimated, by re-resolving the
          // final cost in the adapter's run() method.
          const tokensIn = ev.usage.input_tokens ?? 0;
          const tokensOut = ev.usage.output_tokens ?? 0;
          this.opts.onUsage?.({
            tokensIn,
            tokensOut,
            costUsd: this.opts.estimateCost?.(tokensIn, tokensOut) ?? 0,
          });
        }
        return;
      case 'turn.failed':
        this.lastError = ev.error?.message ?? null;
        return;
      case 'error':
        this.lastError = ev.message ?? null;
        return;
      default:
        return;
    }
  }

  /**
   * Translate codex item lifecycle events for non-`agent_message`
   * items (command_execution, file_change, reasoning, tool_call, ...)
   * into ActivityEvent emissions.
   *
   * - on `item.started`  -> emit `tool_use` (once)
   * - on `item.completed` -> emit `tool_result` with status flag
   * - on `item.updated` -> ignore (would be too chatty)
   * - reasoning items     -> emit a single `thinking` event when
   *   they complete with a non-empty summary
   */
  private handleStructuredItem(eventType: string, item: CodexItem): void {
    if (!item.id) return;
    if (item.type === 'reasoning') {
      if (eventType === 'item.completed' && item.summary) {
        this.opts.onActivity?.({ kind: 'thinking', text: item.summary });
      }
      return;
    }
    const tool = mapCodexItemTypeToTool(item.type ?? '');
    if (!tool) return;
    const desc = describeCodexItem(tool, item);

    if (eventType === 'item.started' && !this.startedTools.has(item.id)) {
      this.startedTools.add(item.id);
      this.opts.onActivity?.({
        kind: 'tool_use',
        tool,
        description: desc,
        toolUseId: item.id,
      });
      return;
    }
    if (eventType === 'item.completed') {
      const status = item.status ?? '';
      const ok = status !== 'failed' && status !== 'error';
      this.opts.onActivity?.({
        kind: 'tool_result',
        tool,
        ok,
        body: codexResultBody(tool, item, ok),
        toolUseId: item.id,
      });
      return;
    }
  }

  /**
   * Concatenated text of every agent_message in this run, joined in
   * the order they first appeared. Multiple agent_messages typically
   * mean codex made a tool call in between, so we separate them with
   * blank lines to keep the rendered markdown readable.
   */
  finalText(): string {
    const pieces: string[] = [];
    for (const id of this.agentOrder) {
      const t = this.agentTexts.get(id);
      if (t && t.length > 0) pieces.push(t);
    }
    return pieces.join('\n\n');
  }
}

/**
 * Map a codex `item.type` to a normalised tool name shared with the
 * Claude Code adapter so the REPL renderer doesn't need to special-case
 * each backend.
 */
function mapCodexItemTypeToTool(itemType: string): string | null {
  switch (itemType) {
    case 'command_execution':
      return 'Bash';
    case 'file_change':
      return 'Edit';
    case 'tool_call':
      return 'Tool';
    case 'web_search':
      return 'WebSearch';
    case 'web_fetch':
      return 'WebFetch';
    default:
      return null;
  }
}

function describeCodexItem(tool: string, item: CodexItem): string {
  if (tool === 'Bash') {
    const cmd = item.command ?? '';
    return cmd ? `Ran ${oneLine(cmd, 100)}` : 'Ran shell command';
  }
  if (tool === 'Edit') {
    const paths = collectFilePaths(item);
    if (paths.length === 0) return 'Edited file';
    if (paths.length === 1) return `Edited ${shortPath(paths[0]!)}`;
    return `Edited ${paths.length} files (${shortPath(paths[0]!)}, ...)`;
  }
  if (tool === 'WebFetch' && typeof item.args?.url === 'string') {
    return `Fetched ${item.args.url}`;
  }
  if (tool === 'WebSearch' && typeof item.args?.query === 'string') {
    return `Searched the web for '${oneLine(item.args.query, 60)}'`;
  }
  // Generic fallback: capitalised tool name (and the item.name when
  // codex tags it, e.g. for a custom MCP tool).
  const head = tool.charAt(0).toUpperCase() + tool.slice(1);
  return `${head}${item.name ? ` ${item.name}` : ''}`;
}

function collectFilePaths(item: CodexItem): string[] {
  if (Array.isArray(item.changes)) {
    return item.changes
      .map((c) => c.path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
  }
  return typeof item.path === 'string' ? [item.path] : [];
}

/**
 * Capture the multi-line output of a codex item for the activity
 * feed. We always include `aggregated_output` when present (that's
 * the actual stdout for command_execution). For successful Edits
 * we suppress the body because the per-file change panel at end
 * of run already shows what landed; surfacing both would duplicate.
 * On failure we always surface the body so the user sees the error.
 */
function codexResultBody(tool: string, item: CodexItem, ok: boolean): string | undefined {
  const raw = item.aggregated_output;
  if (raw && raw.trim().length > 0) {
    if (ok && tool === 'Edit') return undefined;
    const trimmed = raw.trim();
    if (trimmed.length <= 4096) return trimmed;
    return `${trimmed.slice(0, 4096)}\n... [truncated]`;
  }
  if (!ok && item.status) return item.status;
  return undefined;
}

function oneLine(s: string, max = 120): string {
  const compact = s.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}...`;
}

function shortPath(p: string): string {
  const parts = p.split('/');
  if (parts.length <= 4) return p;
  return `.../${parts.slice(-3).join('/')}`;
}

/**
 * Scan codex's stderr for the canonical `ERROR: {json}` line it writes
 * when the upstream API rejects a request. Returns a human-readable
 * one-liner instead of dumping the full JSON blob into the REPL. We
 * keep this best-effort: any parse failure means we fall through to
 * the raw output in the caller.
 */
function parseCodexErrorHint(stderr: string): string | null {
  const match = stderr.match(/ERROR:\s*(\{.+?\})/);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as {
      error?: { message?: string; type?: string };
    };
    const msg = parsed.error?.message;
    if (!msg) return null;
    // The most common failure mode for ChatGPT-account auth is a model
    // restriction; rewrite that into actionable advice instead of just
    // surfacing the API error verbatim.
    if (/not supported when using Codex with a ChatGPT account/i.test(msg)) {
      return (
        `codex rejected the requested model: ${msg}\n` +
        `hint: this happens when codex is logged in via a ChatGPT account and we tried to override its model. ` +
        `disable the codex host in /setup, or run \`codex login\` with an OpenAI API key.`
      );
    }
    return `codex API error: ${msg}`;
  } catch {
    return null;
  }
}
