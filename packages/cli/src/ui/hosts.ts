import { whichSync } from '@coderouter/core';

export type HostProvider = 'codex' | 'claude_code' | 'ollama';

/**
 * Env-var name the core registry reads to gate a host out of routing
 * decisions even when its binary is still on PATH. Set by the CLI when
 * the user toggles a host off in `/hosts`.
 */
export const HOST_DISABLE_ENV: Record<HostProvider, string> = {
  codex: 'CODEROUTER_DISABLE_CODEX',
  claude_code: 'CODEROUTER_DISABLE_CLAUDE_CODE',
  ollama: 'CODEROUTER_DISABLE_OLLAMA',
};

/**
 * One detected host CLI we can route to without an API key.
 * - `binPath`: absolute path we found on PATH.
 * - `provider`: `ProviderRegistry` name the router uses to dispatch.
 * - `enabled`: whether the user has *opted in* to using this host;
 *   default true. When false the welcome panel hides it and the
 *   router's `isReady` check skips it.
 */
export type DetectedHost = {
  provider: HostProvider;
  cli: string;
  label: string;
  binPath: string;
  /** What we'd say in the UI to describe what this gets you. */
  blurb: string;
  enabled: boolean;
};

const HOST_DEFS: Array<Omit<DetectedHost, 'binPath' | 'enabled'> & { bin: string }> = [
  {
    provider: 'codex',
    cli: 'codex',
    bin: 'codex',
    label: 'OpenAI Codex CLI',
    blurb: 'routes deep-reasoning + agentic tasks through your Codex subscription',
  },
  {
    provider: 'claude_code',
    cli: 'claude',
    bin: 'claude',
    label: 'Claude Code',
    blurb: 'routes balanced + multi-file work through your Claude Code subscription',
  },
  {
    provider: 'ollama',
    cli: 'ollama',
    bin: 'ollama',
    label: 'Ollama',
    blurb: 'routes trivial + offline tasks to local models on your machine',
  },
];

/**
 * Sync detection of host CLIs at REPL startup. We only check that the
 * binary is on PATH; we don't probe `codex auth status` etc. because
 * (a) it costs a subprocess per provider and (b) the adapter will
 * surface auth errors at call time anyway.
 *
 * Disabled hosts are still returned (with `enabled: false`) so the
 * `/hosts` picker can show them as togglable; callers that just want
 * "what's actively routing" should filter by `enabled`.
 */
export function detectHosts(): DetectedHost[] {
  const out: DetectedHost[] = [];
  for (const def of HOST_DEFS) {
    const binPath = whichSync(def.bin);
    if (!binPath) continue;
    out.push({
      provider: def.provider,
      cli: def.cli,
      label: def.label,
      binPath,
      blurb: def.blurb,
      enabled: process.env[HOST_DISABLE_ENV[def.provider]] !== '1',
    });
  }
  return out;
}
