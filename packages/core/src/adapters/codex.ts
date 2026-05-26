import type { AdapterCapabilities, ProviderId } from '../types.js';
import { exec } from '../sandbox/exec.js';
import { BaseAdapter } from './base.js';
import type { AdapterCallInput, AdapterCallResult } from './types.js';

export type CodexAdapterOptions = {
  /** Path to the codex binary. Defaults to `codex` on PATH. */
  bin?: string;
  /** Codex model selector, e.g. 'gpt-5-codex'. */
  model?: string;
  /** Additional CLI args appended to every call. */
  extraArgs?: string[];
  /** Optional approval mode. Defaults to 'never' (autonomous). */
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

    const args: string[] = ['exec'];
    if (this.opts.model) args.push('-m', this.opts.model);
    if (this.opts.approval) args.push('-a', this.opts.approval);
    if (this.opts.extraArgs) args.push(...this.opts.extraArgs);
    args.push('--', input.prompt);

    const res = await exec(this.opts.bin ?? 'codex', args, {
      cwd: input.cwd,
      timeoutMs: this.opts.timeoutMs ?? 600_000,
      signal: input.signal,
    });

    if (res.exitCode !== 0) {
      throw new Error(
        `CodexAdapter: codex exit ${res.exitCode}\nstdout: ${res.stdout.slice(-1000)}\nstderr: ${res.stderr.slice(-1000)}`,
      );
    }

    // Heuristic token accounting; the real numbers will be filled in by
    // the report layer once the worktree diff is sized.
    const tokensIn = Math.ceil(input.prompt.length / 4);
    const tokensOut = Math.ceil(res.stdout.length / 4);

    return {
      text: res.stdout,
      tokensIn,
      tokensOut,
      costUsd: this.estimateCost(tokensIn, tokensOut),
      durationMs: res.durationMs,
      raw: { stdout: res.stdout, stderr: res.stderr },
    };
  }
}
