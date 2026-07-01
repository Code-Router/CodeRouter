import type { AdapterCapabilities, ProviderId } from '../types.js';
import { exec } from '../sandbox/exec.js';
import { BaseAdapter } from './base.js';
import { buildEditPreview } from './editPreview.js';
import type {
  ActivityEvent,
  AdapterCallInput,
  AdapterCallResult,
  AskUserQuestionEntry,
  AskUserQuestionPayload,
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

    // First attempt - replay the prior conversation if the caller
    // has a session id. `claude --resume <id>` rehydrates the
    // model's context window so follow-up prompts ("you run it",
    // "the game you just made") actually reach a model that
    // remembers the original turn.
    let result = await this.runOnce(input, input.resumeSessionId);

    // Stale resume id: claude returns exit 1 with
    // `No conversation found with session ID: …` whenever the
    // session has expired or was created in a previous CLI install.
    // Drop the resume id and retry once with a fresh conversation
    // so the user isn't permanently blocked.
    if (result.staleSession && input.resumeSessionId) {
      result = await this.runOnce(input, undefined);
    }

    if (result.exitCode !== 0) {
      throw new Error(
        `ClaudeCodeAdapter: claude exit ${result.exitCode}\nstdout: ${result.stdoutTail}\nstderr: ${result.stderrTail}`,
      );
    }

    const finalText = result.finalText;
    const tokensIn = result.tokensIn;
    const tokensOut = result.tokensOut;
    const costUsd = result.costUsd;

    return {
      text: finalText,
      tokensIn,
      tokensOut,
      costUsd,
      durationMs: result.durationMs,
      sessionId: result.sessionId,
      raw: result.raw,
    };
  }

  /**
   * One invocation of the `claude` CLI. Wrapped so the public `run`
   * method can fall back from `--resume <stale-id>` to a fresh
   * session without duplicating the parser/exec wiring.
   *
   * Returns a plain bag of fields rather than throwing on non-zero
   * exit; the caller decides whether to retry or surface the error.
   */
  private async runOnce(
    input: AdapterCallInput,
    resumeSessionId: string | undefined,
  ): Promise<{
    exitCode: number;
    stdoutTail: string;
    stderrTail: string;
    durationMs: number;
    finalText: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    sessionId: string | undefined;
    staleSession: boolean;
    raw: unknown;
  }> {
    let prompt = input.prompt;
    if (input.images && input.images.length > 0) {
      prompt += `\n\nAttached image(s):\n${input.images.map((p) => `  ${p}`).join('\n')}`;
    }
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
    if (this.opts.model) args.push('--model', this.opts.model);
    // Read-only callers (plan / debug / review modes running in the
    // user's real cwd, not a sandbox worktree) keep bypassPermissions
    // so read tools never stall on approval, but the mutating tools
    // are denied outright. We deliberately do NOT use
    // `--permission-mode plan` here: that flips Claude into its
    // plan-file workflow and the answer comes back as "Plan ready
    // for review at ~/.claude/plans/…" instead of inline text.
    args.push('--permission-mode', this.opts.permissionMode ?? 'bypassPermissions');
    if (input.readOnly) {
      args.push('--disallowedTools', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash');
    }
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    if (this.opts.extraArgs) args.push(...this.opts.extraArgs);

    const parser = new ClaudeJsonStream({
      onChunk: input.onChunk,
      onActivity: input.onActivity,
      onUsage: input.onUsage,
      estimateCost: (i: number, o: number) => this.estimateCost(i, o),
      onModelResolved: input.onModelResolved,
      onUserQuestion: input.onUserQuestion,
    });

    const res = await exec(this.opts.bin ?? 'claude', args, {
      cwd: input.cwd!,
      timeoutMs: this.opts.timeoutMs ?? 600_000,
      signal: input.signal,
      onStdout: (chunk: string) => parser.push(chunk),
    });
    parser.flush();

    const finalText = parser.finalText() || res.stdout;
    const tokensIn = parser.usage.input_tokens ?? 0;
    const tokensOut = parser.usage.output_tokens ?? 0;
    const costUsd =
      parser.totalCostUsd > 0 ? parser.totalCostUsd : this.estimateCost(tokensIn, tokensOut);

    // Detect the specific "stale resume id" failure mode so the
    // caller can transparently retry without `--resume`. We match
    // both the stderr (the error claude prints when the session
    // store can't find the id) and the structured stdout payload
    // (the `errors[]` array in claude's stream-json result).
    const stderrLooksStale = /No conversation found with session ID:/i.test(res.stderr);
    const stdoutLooksStale =
      /"errors":\s*\[\s*"No conversation found with session ID:/i.test(res.stdout);
    const staleSession =
      res.exitCode !== 0 && resumeSessionId !== undefined && (stderrLooksStale || stdoutLooksStale);

    return {
      exitCode: res.exitCode,
      stdoutTail: res.stdout.slice(-1000),
      stderrTail: res.stderr.slice(-1000),
      durationMs: res.durationMs,
      finalText,
      tokensIn,
      tokensOut,
      costUsd,
      sessionId: parser.sessionId ?? undefined,
      staleSession,
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
  /**
   * Resolved Claude model name (e.g. `claude-sonnet-4-5-20250929`).
   * Surfaced on every assistant message; we use the first one we
   * see to upgrade the route label from the shorthand we requested
   * (`sonnet` / `opus`) to the actual versioned name.
   */
  model?: string;
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
  /**
   * Top-level model field on the `system/init` event Claude Code
   * emits at session start. Same value as `message.model` on later
   * assistant events; we capture whichever arrives first.
   */
  model?: string;
  /**
   * Session identifier on `system/init`. We capture this once per
   * run and surface it on `AdapterCallResult.sessionId` so the REPL
   * can pass it back via `--resume <id>` on the next turn, giving
   * the model conversational memory across prompts.
   */
  session_id?: string;
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
  /**
   * Cumulative token tally across the whole run. Claude reports
   * usage PER assistant message (deltas), not cumulative - so we
   * sum here. The final `result` event carries authoritative totals
   * which we use to overwrite once it arrives.
   */
  usage: ClaudeUsage = { input_tokens: 0, output_tokens: 0 };
  /** Whether the authoritative `result` event has overwritten usage. */
  private usageFinal = false;
  totalCostUsd = 0;
  eventCount = 0;
  resultText: string | null = null;
  /**
   * Claude's authoritative model id (e.g. `claude-sonnet-4-5-20250929`),
   * captured the first time we see it on a `system/init` or assistant
   * event. The CLI's `--model sonnet` shorthand resolves server-side
   * and we want to surface the real identifier on the route label.
   */
  resolvedModel: string | null = null;
  /**
   * Claude Code session id for this run. Captured from the
   * `system/init` event. Surfaced on `AdapterCallResult.sessionId`
   * so the REPL can replay it via `--resume <id>` on follow-up
   * turns to preserve conversational context.
   */
  sessionId: string | null = null;

  constructor(
    private readonly opts: {
      onChunk?: (s: string) => void;
      onActivity?: (e: ActivityEvent) => void;
      onUsage?: (u: { tokensIn: number; tokensOut: number; costUsd: number }) => void;
      estimateCost?: (tokensIn: number, tokensOut: number) => number;
      onModelResolved?: (model: string) => void;
      onUserQuestion?: (payload: AskUserQuestionPayload) => void;
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

    // Capture the resolved model id the first time it appears.
    // `system/init` carries it at the top level; assistant events
    // carry it on `message.model`. Either fires the callback once.
    if (!this.resolvedModel) {
      const modelFromInit =
        ev.type === 'system' && ev.subtype === 'init' ? ev.model : undefined;
      const modelFromAssistant = ev.message?.model;
      const model = modelFromInit ?? modelFromAssistant;
      if (typeof model === 'string' && model.length > 0) {
        this.resolvedModel = model;
        this.opts.onModelResolved?.(model);
      }
    }

    // Capture the session id from system/init exactly once. This is
    // the handle we'll pass to `claude --resume <id>` on the next
    // turn so the model retains the prior conversation.
    if (!this.sessionId && ev.type === 'system' && ev.subtype === 'init' && ev.session_id) {
      this.sessionId = ev.session_id;
    }

    if (ev.type === 'assistant' && ev.message?.content) {
      this.handleAssistantBlocks(ev.message.content);
      if (ev.message.usage && !this.usageFinal) {
        // Claude emits usage PER assistant message (one turn of a
        // larger tool-use loop), not cumulative across the run.
        // Add deltas so the live counter reflects the running total
        // rather than just the most recent message - that's why the
        // spinner used to read "1 in · 3 out" after several minutes
        // of activity.
        this.usage = {
          input_tokens:
            (this.usage.input_tokens ?? 0) + (ev.message.usage.input_tokens ?? 0),
          output_tokens:
            (this.usage.output_tokens ?? 0) + (ev.message.usage.output_tokens ?? 0),
        };
        this.emitUsage();
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
      // The result event is authoritative - it carries the final
      // run-wide totals from claude itself. Overwrite our running
      // sum with these and lock the field so any late assistant
      // events that arrive after `result` don't double-count.
      if (ev.usage) {
        this.usage = ev.usage;
        this.usageFinal = true;
      }
      this.emitUsage();
      return;
    }
  }

  /**
   * Push the current cumulative usage to the UI. Cost prefers
   * claude's authoritative `total_cost_usd` from the result event;
   * before that arrives we fall back to the adapter's per-token
   * estimate so the live counter doesn't sit at $0.0000 the whole
   * way through.
   */
  private emitUsage(): void {
    const tokensIn = this.usage.input_tokens ?? 0;
    const tokensOut = this.usage.output_tokens ?? 0;
    const cost = this.totalCostUsd > 0
      ? this.totalCostUsd
      : (this.opts.estimateCost?.(tokensIn, tokensOut) ?? 0);
    this.opts.onUsage?.({ tokensIn, tokensOut, costUsd: cost });
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
        const preview = buildEditPreview(block.name, block.input ?? {});
        this.opts.onActivity?.({
          kind: 'tool_use',
          tool: block.name,
          description: describeClaudeToolUse(block.name, block.input ?? {}),
          toolUseId,
          path: preview.path,
          patch: preview.patch,
        });
        // The model invoked the built-in interactive-question tool.
        // Headless `claude -p` can't deliver the answer back, so we
        // surface the structured question to the REPL via the
        // dedicated callback - the REPL is then free to abort the
        // run and show an answer prompt to the operator. We still
        // emit the regular tool_use activity above so the question
        // also appears in the activity log for context.
        if (block.name === 'AskUserQuestion' && this.opts.onUserQuestion) {
          const payload = parseAskUserQuestionInput(block.input ?? {});
          if (payload.questions.length > 0) {
            this.opts.onUserQuestion(payload);
          }
        }
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
    case 'AskUserQuestion': {
      // The first question is usually enough for a one-line label;
      // the REPL will render the full payload in its own panel.
      const parsed = parseAskUserQuestionInput(input);
      const first = parsed.questions[0];
      return first ? `Asked: ${oneLine(first.question, 80)}` : 'Asked the user a question';
    }
    default:
      return capitalize(tool);
  }
}

/**
 * Best-effort parse of the `AskUserQuestion` tool's input payload
 * into our typed shape. Tolerant of missing fields and shape
 * variations - returns an empty `questions` array when the input
 * doesn't match anything recognisable, which the caller treats as
 * "don't fire onUserQuestion".
 */
function parseAskUserQuestionInput(input: Record<string, unknown>): AskUserQuestionPayload {
  const rawQuestions = input.questions;
  if (!Array.isArray(rawQuestions)) return { questions: [] };

  const questions: AskUserQuestionEntry[] = [];
  for (const raw of rawQuestions) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    const question = typeof obj.question === 'string' ? obj.question : null;
    if (!question) continue;
    const header = typeof obj.header === 'string' ? obj.header : undefined;
    const multiSelect = obj.multiSelect === true;
    const rawOptions = obj.options;
    const options: AskUserQuestionEntry['options'] = [];
    if (Array.isArray(rawOptions)) {
      for (const optRaw of rawOptions) {
        if (!optRaw || typeof optRaw !== 'object') continue;
        const opt = optRaw as Record<string, unknown>;
        const label = typeof opt.label === 'string' ? opt.label : null;
        if (!label) continue;
        const description = typeof opt.description === 'string' ? opt.description : undefined;
        options.push({ label, description });
      }
    }
    questions.push({
      question,
      header,
      multiSelect,
      options: options.length > 0 ? options : undefined,
    });
  }
  return { questions };
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
