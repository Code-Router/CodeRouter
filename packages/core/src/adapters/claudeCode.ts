import type { AdapterCapabilities, ProviderId } from '../types.js';
import { exec } from '../sandbox/exec.js';
import { BaseAdapter } from './base.js';
import type { AdapterCallInput, AdapterCallResult } from './types.js';

export type ClaudeCodeAdapterOptions = {
  /** Path to the claude binary. Defaults to `claude` on PATH. */
  bin?: string;
  /** Claude model selector, e.g. 'claude-opus-4-1' or 'sonnet'. */
  model?: string;
  /** Additional CLI args appended to every call. */
  extraArgs?: string[];
  timeoutMs?: number;
  pricePer1MIn?: number;
  pricePer1MOut?: number;
};

type StreamJsonEvent = {
  type?: string;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  result?: string;
  total_cost_usd?: number;
  total_duration_ms?: number;
};

/**
 * Claude Code CLI adapter. Spawns `claude -p ... --output-format stream-json`
 * and parses the JSONL event stream to extract the final result, token
 * usage, and cost (which Claude Code reports honestly).
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
    if (this.opts.extraArgs) args.push(...this.opts.extraArgs);

    const res = await exec(this.opts.bin ?? 'claude', args, {
      cwd: input.cwd,
      timeoutMs: this.opts.timeoutMs ?? 600_000,
      signal: input.signal,
    });

    if (res.exitCode !== 0) {
      throw new Error(
        `ClaudeCodeAdapter: claude exit ${res.exitCode}\nstdout: ${res.stdout.slice(-1000)}\nstderr: ${res.stderr.slice(-1000)}`,
      );
    }

    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd = 0;
    let finalText = '';

    for (const line of res.stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as StreamJsonEvent;
        if (ev.message?.usage) {
          tokensIn += ev.message.usage.input_tokens ?? 0;
          tokensOut += ev.message.usage.output_tokens ?? 0;
        }
        if (typeof ev.total_cost_usd === 'number') costUsd = ev.total_cost_usd;
        if (ev.type === 'result' && typeof ev.result === 'string') finalText = ev.result;
      } catch {
        // non-JSON line (e.g. progress noise) - safe to ignore
      }
    }

    if (!finalText) finalText = res.stdout;
    if (costUsd === 0) costUsd = this.estimateCost(tokensIn, tokensOut);

    return {
      text: finalText,
      tokensIn,
      tokensOut,
      costUsd,
      durationMs: res.durationMs,
      raw: { stdout: res.stdout, stderr: res.stderr },
    };
  }
}
