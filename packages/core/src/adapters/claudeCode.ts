import type { AdapterCapabilities, ProviderId } from '../types.js';
import { exec } from '../sandbox/exec.js';
import { BaseAdapter } from './base.js';
import type {
  ActivityEvent,
  AdapterCallInput,
  AdapterCallResult,
} from './types.js';

export type ClaudeCodeAdapterOptions = {
  /** Path to the claude binary. Defaults to `claude` on PATH. */
  bin?: string;
  /** Claude model selector, e.g. 'claude-opus-4-1' or 'sonnet'. */
  model?: string;
  /** Additional CLI args appended to every call. */
  extraArgs?: string[];
  /**
   * Claude Code permission mode. Defaults to `bypassPermissions`
   * because we run claude inside a CodeRouter-managed git worktree
   * (`.coderouter/runs/<id>/`) which is already sandboxed - asking
   * the user to approve every Write/Edit/Bash call would stall the
   * non-interactive `claude -p` invocation (there's no UI channel
   * to deliver the approval prompt). Override to `acceptEdits` if
   * you want shell commands to still prompt, or `default` for the
   * full prompting experience.
   */
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  timeoutMs?: number;
  pricePer1MIn?: number;
  pricePer1MOut?: number;
};

/**
 * Claude Code CLI adapter. Spawns `claude -p ... --output-format stream-json`
 * and parses the JSONL event stream incrementally so the REPL can
 * surface the model's text and its tool calls in real time. We keep
 * track of usage / cost / final result for the report layer at the
 * same time.
 */
export class ClaudeCodeAdapter extends BaseAdapter {
  id: ProviderId = 'claude_code';
  name = 'Claude Code';
  capabilities: AdapterCapabilities;

  constructor(public readonly opts: ClaudeCodeAdapterOptions = {}) {
    super();
    this.capabilities = {
      canEdit: true,
      canPlan: true,
      longContext: false,
      reasoning: true,
      tools: true,
      streaming: true,
      vision: true,
      pricePer1MIn: opts.pricePer1MIn ?? 3,
      pricePer1MOut: opts.pricePer1MOut ?? 15,
      contextWindow: 200_000,
      family: 'shell-agent',
    };
  }

  override async run(input: AdapterCallInput): Promise<AdapterCallResult> {
    if (!input.cwd) throw new Error('ClaudeCodeAdapter requires `cwd` (a worktree path)');

    const args = ['-p', input.prompt, '--output-format', 'stream-json', '--verbose'];
    if (this.opts.model) args.push('--model', this.opts.model);
    args.push('--permission-mode', this.opts.permissionMode ?? 'bypassPermissions');
    if (this.opts.extraArgs) args.push(...this.opts.extraArgs);

    const parser = new ClaudeJsonStream({
      onChunk: input.onChunk,
      onActivity: input.onActivity,
    });

    const res = await exec(this.opts.bin ?? 'claude', args, {
      cwd: input.cwd,
      timeoutMs: this.opts.timeoutMs ?? 600_000,
      signal: input.signal,
      onStdout: (chunk: string) => parser.push(chunk),
    });
    parser.flush();

    if (res.exitCode !== 0) {
      throw new Error(
        `ClaudeCodeAdapter: claude exit ${res.exitCode}\nstdout: ${res.stdout.slice(-1000)}\nstderr: ${res.stderr.slice(-1000)}`,
      );
    }

    const finalText = parser.finalText() || res.stdout;
    const tokensIn = parser.usage.input_tokens ?? 0;
    const tokensOut = parser.usage.output_tokens ?? 0;
    const costUsd = parser.totalCostUsd > 0 ? parser.totalCostUsd : this.estimateCost(tokensIn, tokensOut);

    return {
      text: finalText,
      tokensIn,
      tokensOut,
      costUsd,
      durationMs: res.durationMs,
      raw: { stdout: res.stdout, stderr: res.stderr, events: parser.eventCount },
    };
  }
}

type ClaudeUsage = { input_tokens?: number; output_tokens?: number };

type ClaudeContentBlock = {
  type?: string;
  text?: string;
  // tool_use
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result
  tool_use_id?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  is_error?: boolean;
};

type ClaudeMessage = {
  role?: 'assistant' | 'user';
  content?: ClaudeContentBlock[];
  usage?: ClaudeUsage;
};

type ClaudeStreamEvent = {
  type?: string;
  subtype?: string;
  message?: ClaudeMessage;
  // result event
  result?: string;
  total_cost_usd?: number;
  is_error?: boolean;
  num_turns?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  usage?: ClaudeUsage;
};

/**
 * Stateful JSONL parser for `claude -p --output-format stream-json --verbose`.
 *
 * Claude emits the following relevant event shapes (one JSON object
 * per line):
 *
 *   - `{type:"system", subtype:"init", ...}`   - session start, ignored
 *   - `{type:"assistant", message:{content:[...]}}`
 *       text blocks  -> append to running text, fire onChunk(delta)
 *       tool_use     -> fire onActivity({kind:'tool_use', ...})
 *   - `{type:"user",      message:{content:[...]}}`
 *       tool_result  -> fire onActivity({kind:'tool_result', ...})
 *   - `{type:"result", result:"<final>", total_cost_usd, usage, ...}`
 *
 * We use `result.result` as the canonical final text when present
 * (claude's last assistant message and the result string usually
 * agree, but the result event is the authoritative one). Token
 * usage and cost come from the result event too.
 */
class ClaudeJsonStream {
  private buffer = '';
  /** Accumulated text deltas across all assistant messages this run. */
  private textSoFar = '';
  /** tool_use_id -> tool name, so tool_results can recover the name. */
  private toolNames = new Map<string, string>();
  usage: ClaudeUsage = {};
  totalCostUsd = 0;
  eventCount = 0;
  resultText: string | null = null;

  constructor(
    private readonly opts: {
      onChunk?: (s: string) => void;
      onActivity?: (e: ActivityEvent) => void;
    },
  ) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      this.handleLine(line);
    }
  }

  flush(): void {
    if (this.buffer.trim().length > 0) {
      this.handleLine(this.buffer);
      this.buffer = '';
    }
  }

  finalText(): string {
    return this.resultText ?? this.textSoFar;
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let ev: ClaudeStreamEvent;
    try {
      ev = JSON.parse(trimmed) as ClaudeStreamEvent;
    } catch {
      return;
    }
    this.eventCount += 1;

    if (ev.type === 'assistant' && ev.message?.content) {
      this.handleAssistantBlocks(ev.message.content);
      if (ev.message.usage) {
        // claude reports cumulative usage on every assistant message;
        // overwrite (not add) so we end with the final tally.
        this.usage = ev.message.usage;
      }
      return;
    }
    if (ev.type === 'user' && ev.message?.content) {
      this.handleUserBlocks(ev.message.content);
      return;
    }
    if (ev.type === 'result') {
      if (typeof ev.result === 'string') this.resultText = ev.result;
      if (typeof ev.total_cost_usd === 'number') this.totalCostUsd = ev.total_cost_usd;
      if (ev.usage) this.usage = ev.usage;
      return;
    }
  }

  private handleAssistantBlocks(blocks: ClaudeContentBlock[]): void {
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        // claude (with --verbose stream-json) sends each assistant
        // message in one shot rather than as token-level deltas, so
        // the "delta" here is the gap between what we've already
        // forwarded and the new total.
        const incoming = block.text;
        if (incoming.length > this.textSoFar.length && incoming.startsWith(this.textSoFar)) {
          const delta = incoming.slice(this.textSoFar.length);
          this.textSoFar = incoming;
          this.opts.onChunk?.(delta);
        } else {
          // New independent text block (e.g. between tool calls).
          // Separate with a blank line so the rendered markdown
          // stays readable.
          if (this.textSoFar.length > 0) {
            this.opts.onChunk?.('\n\n');
            this.textSoFar += '\n\n';
          }
          this.textSoFar += incoming;
          this.opts.onChunk?.(incoming);
        }
        continue;
      }
      if (block.type === 'tool_use' && block.name) {
        const toolUseId = block.id;
        if (toolUseId) this.toolNames.set(toolUseId, block.name);
        this.opts.onActivity?.({
          kind: 'tool_use',
          tool: block.name,
          description: describeClaudeToolUse(block.name, block.input ?? {}),
          toolUseId,
        });
        continue;
      }
    }
  }

  private handleUserBlocks(blocks: ClaudeContentBlock[]): void {
    for (const block of blocks) {
      if (block.type !== 'tool_result') continue;
      const toolUseId = block.tool_use_id;
      const tool = (toolUseId && this.toolNames.get(toolUseId)) || 'tool';
      const ok = block.is_error !== true;
      let raw: string | undefined;
      if (typeof block.content === 'string') {
        raw = block.content;
      } else if (Array.isArray(block.content)) {
        raw = block.content
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text as string)
          .join('\n');
      }
      // Tool-specific filtering: a Read result is the entire file
      // contents (verbose, uninteresting in the activity feed); a
      // Bash result is the captured stdout (the part the user
      // actually wants to see). We keep small bodies as-is and
      // clip large bodies in the UI layer.
      const body = bodyForTool(tool, raw, ok);
      this.opts.onActivity?.({
        kind: 'tool_result',
        tool,
        ok,
        body,
        toolUseId,
      });
    }
  }
}

/**
 * Decide what (if anything) to surface as the body of a tool_result
 * block in the REPL activity feed.
 *   - Bash always shows its output (stdout/stderr).
 *   - Edit/Write/MultiEdit are visually represented by the per-file
 *     stats panel at end of run; their body is just an "ok" string
 *     that would clutter the live feed.
 *   - Read returns whole files; suppressing it keeps the feed
 *     scannable. Errors still surface.
 *   - Grep/Glob get the result body so the user can see what was
 *     found.
 *   - Anything else: pass through.
 *
 * Bodies are size-capped before reaching the wire so a 50k-line
 * file in a Read error doesn't blow up the IPC channel.
 */
function bodyForTool(tool: string, raw: string | undefined, ok: boolean): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!ok) return clipBody(trimmed);
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'TodoWrite':
      return undefined;
    default:
      return clipBody(trimmed);
  }
}

function clipBody(s: string): string {
  // Wire-level cap so a giant file content doesn't get serialized.
  // The REPL further trims for display; this is just a safety belt.
  const MAX = 4096;
  if (s.length <= MAX) return s;
  return `${s.slice(0, MAX)}\n... [truncated]`;
}

/**
 * Render a one-line description of a Claude Code tool invocation
 * suitable for the REPL activity feed. Falls back to `<Tool>(...)` if
 * we don't have a custom formatter for the tool, so unknown tools
 * still show up as activity entries.
 */
/**
 * Past-tense, sentence-case block headlines that match the codex
 * UX:
 *   - "Ran git status"
 *   - "Read packages/foo.ts"
 *   - "Edited src/bar.ts"
 *   - "Searched 'pattern'"
 * Read by the REPL as the bold first line of each tool block.
 */
function describeClaudeToolUse(tool: string, input: Record<string, unknown>): string {
  const get = (k: string): string | undefined => {
    const v = input[k];
    return typeof v === 'string' ? v : undefined;
  };
  const file = get('file_path') ?? get('path') ?? get('filename');
  switch (tool) {
    case 'Read':
      return file ? `Read ${shortPath(file)}` : 'Read';
    case 'Write':
      return file ? `Wrote ${shortPath(file)}` : 'Wrote file';
    case 'Edit':
      return file ? `Edited ${shortPath(file)}` : 'Edited file';
    case 'MultiEdit': {
      const edits = input.edits;
      const count = Array.isArray(edits) ? edits.length : 0;
      const editsLabel = count ? ` (${count} change${count === 1 ? '' : 's'})` : '';
      return file ? `Edited ${shortPath(file)}${editsLabel}` : 'Edited file';
    }
    case 'Bash': {
      const cmd = get('command');
      return cmd ? `Ran ${oneLine(cmd, 100)}` : 'Ran shell command';
    }
    case 'Grep': {
      const pattern = get('pattern');
      const path = get('path') ?? get('include');
      const inPart = path ? ` in ${shortPath(path)}` : '';
      return pattern ? `Searched ${quoted(pattern)}${inPart}` : 'Searched';
    }
    case 'Glob': {
      const pattern = get('pattern');
      return pattern ? `Listed files matching ${quoted(pattern)}` : 'Listed files';
    }
    case 'WebFetch': {
      const url = get('url');
      return url ? `Fetched ${url}` : 'Fetched URL';
    }
    case 'WebSearch': {
      const query = get('query');
      return query ? `Searched the web for ${quoted(query)}` : 'Searched the web';
    }
    case 'TodoWrite':
      return 'Updated plan';
    case 'Task': {
      const desc = get('description') ?? get('prompt');
      return desc ? `Delegated to subagent: ${oneLine(desc, 60)}` : 'Delegated to subagent';
    }
    default:
      return capitalize(tool);
  }
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortPath(p: string): string {
  // Trim leading cwd-relative directory components when very deep.
  const parts = p.split('/');
  if (parts.length <= 4) return p;
  return `.../${parts.slice(-3).join('/')}`;
}

function oneLine(s: string, max = 120): string {
  const compact = s.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}...`;
}

function quoted(s: string): string {
  return `'${oneLine(s, 60)}'`;
}
