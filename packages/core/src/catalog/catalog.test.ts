import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultProviders, ProviderRegistry } from '../providers/registry.js';
import { CATALOG } from './entries.js';
import { resolveIntent, resetCodexAuthCache } from './resolve.js';

function fresh(): ProviderRegistry {
  return new ProviderRegistry(defaultProviders());
}

function isolate(): void {
  // Tests in this file want deterministic ready-state, so wipe both
  // env vars *and* PATH (`isReady` reads PATH at call time for the
  // local-CLI adapters).
  for (const k of [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
  ]) {
    delete process.env[k];
  }
  process.env.PATH = '';
  delete process.env.CODEX_HOME;
  resetCodexAuthCache();
}

/**
 * Spin up a fake codex install:
 *   - a temp `bin/codex` executable so `whichSync('codex')` returns truthy
 *   - a temp `auth.json` with the requested mode
 *   - PATH pointing at the temp bin dir so the registry sees codex as ready
 *
 * Returns a cleanup function the test should call in `afterEach`.
 */
function stubCodexAuth(mode: 'chatgpt' | 'apikey'): () => void {
  const binDir = mkdtempSync(join(tmpdir(), 'codex-bin-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'codex-home-'));

  const codexBin = join(binDir, 'codex');
  writeFileSync(codexBin, '#!/bin/sh\nexit 0\n', 'utf8');
  chmodSync(codexBin, 0o755);

  const authPayload =
    mode === 'apikey'
      ? { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-test' }
      : { auth_mode: 'chatgpt', OPENAI_API_KEY: null };
  writeFileSync(join(homeDir, 'auth.json'), JSON.stringify(authPayload), 'utf8');

  const prevPath = process.env.PATH;
  process.env.PATH = binDir;
  process.env.CODEX_HOME = homeDir;
  resetCodexAuthCache();
  return () => {
    process.env.PATH = prevPath ?? '';
    delete process.env.CODEX_HOME;
    resetCodexAuthCache();
  };
}

describe('catalog entries', () => {
  it('every catalog entry references a known provider', () => {
    const reg = fresh();
    const known = new Set(reg.list().map((p) => p.name));
    for (const entry of CATALOG) {
      expect(known.has(entry.provider), `unknown provider ${entry.provider}`).toBe(true);
    }
  });

  it('every entry has at least one intent binding', () => {
    for (const entry of CATALOG) {
      expect(entry.intents.length, `${entry.provider}/${entry.model} has no intents`).toBeGreaterThan(0);
    }
  });
});

describe('resolveIntent', () => {
  it('returns null when no provider is ready', () => {
    isolate();
    const r = resolveIntent('deep-reasoning', fresh());
    expect(r).toBeNull();
  });

  it('picks the highest-ranked entry whose provider is ready', () => {
    isolate();
    process.env.OPENAI_API_KEY = 'sk-test';
    const r = resolveIntent('deep-reasoning', fresh());
    expect(r).not.toBeNull();
    expect(r!.via).toBe('openai');
    expect(r!.model).toMatch(/^gpt-5/);
  });

  it('honors forbidRoutes', () => {
    isolate();
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const r = resolveIntent('multi-file', fresh(), {
      forbidRoutes: ['anthropic,claude-opus-4-5'],
    });
    expect(r).not.toBeNull();
    // We forbade the opus-4-5 row specifically; anthropic can still
    // serve `multi-file` via claude-sonnet-4-5 at a lower rank.
    expect(r!.model).not.toBe('claude-opus-4-5');
  });

  it('returns rationale tagged with the intent + rank', () => {
    isolate();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const r = resolveIntent('balanced-agent', fresh());
    expect(r!.rationale).toMatch(/^balanced-agent:/);
  });
});

describe('codex deprioritisation under ChatGPT auth', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('routes deep-reasoning to a cloud API when codex is chatgpt-authed', () => {
    isolate();
    cleanup = stubCodexAuth('chatgpt');
    process.env.OPENAI_API_KEY = 'sk-test';
    const r = resolveIntent('deep-reasoning', fresh());
    expect(r).not.toBeNull();
    // Codex is heavily quality-penalised under ChatGPT auth, so the
    // configured OpenAI key wins with a GPT-5-class model.
    expect(r!.via).toBe('openai');
    expect(r!.model).toMatch(/^gpt-5/);
  });

  it('still uses codex for deep-reasoning when it is the only ready provider', () => {
    isolate();
    cleanup = stubCodexAuth('chatgpt');
    const r = resolveIntent('deep-reasoning', fresh());
    expect(r).not.toBeNull();
    expect(r!.via).toBe('codex');
  });

  it('keeps codex on top for deep-reasoning when api-key authed', () => {
    isolate();
    cleanup = stubCodexAuth('apikey');
    process.env.OPENAI_API_KEY = 'sk-test';
    const r = resolveIntent('deep-reasoning', fresh());
    expect(r).not.toBeNull();
    expect(r!.via).toBe('codex');
  });

  it('does NOT penalise codex for balanced-agent or fast-cheap', () => {
    isolate();
    cleanup = stubCodexAuth('chatgpt');
    const r = resolveIntent('balanced-agent', fresh());
    expect(r).not.toBeNull();
    // claude_code (not stubbed) is unavailable; codex@balanced-agent
    // rank 2 wins.
    expect(r!.via).toBe('codex');
  });
});
