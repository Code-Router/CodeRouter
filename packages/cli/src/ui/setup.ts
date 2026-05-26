import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The first-class providers we surface in the `/setup` wizard. Order
 * here is the order shown in the picker.
 */
export type SetupProvider = {
  name: string;
  envVar: string;
  label: string;
  example: string;
};

export const SETUP_PROVIDERS: readonly SetupProvider[] = [
  { name: 'anthropic',  envVar: 'ANTHROPIC_API_KEY',  label: 'Anthropic (Claude)',          example: 'sk-ant-...' },
  { name: 'openai',     envVar: 'OPENAI_API_KEY',     label: 'OpenAI (GPT, o-series)',      example: 'sk-...' },
  { name: 'google',     envVar: 'GOOGLE_API_KEY',     label: 'Google (Gemini)',             example: 'AIza...' },
  { name: 'openrouter', envVar: 'OPENROUTER_API_KEY', label: 'OpenRouter (all-in-one)',     example: 'sk-or-...' },
  { name: 'deepseek',   envVar: 'DEEPSEEK_API_KEY',   label: 'DeepSeek',                    example: 'sk-...' },
  { name: 'groq',       envVar: 'GROQ_API_KEY',       label: 'Groq',                        example: 'gsk_...' },
];

export const CREDENTIALS_PATH = join(homedir(), '.coderouter', 'credentials.json');

type CredentialsFile = {
  providers?: Record<string, { apiKey?: string }>;
};

/**
 * Hydrate process.env from the persisted credentials file. Safe to call
 * multiple times; existing env vars (e.g. set in the user's shell rc)
 * take precedence and are never overwritten.
 *
 * Returns the env vars that ended up populated by the loader so callers
 * can show a "loaded from credentials.json" hint.
 */
export function loadCredentialsIntoEnv(): { applied: string[] } {
  const applied: string[] = [];
  let parsed: CredentialsFile;
  try {
    const raw = readFileSync(CREDENTIALS_PATH, 'utf8');
    parsed = JSON.parse(raw) as CredentialsFile;
  } catch {
    return { applied };
  }
  for (const p of SETUP_PROVIDERS) {
    if (process.env[p.envVar]) continue;
    const key = parsed.providers?.[p.name]?.apiKey;
    if (key) {
      process.env[p.envVar] = key;
      applied.push(p.envVar);
    }
  }
  return { applied };
}

/**
 * Persist a single provider's API key to the credentials file (creating
 * the file + parent dir if needed) and also set it on process.env so
 * the current REPL session can use it immediately.
 *
 * The file is written with 0600 permissions because API keys.
 */
export function saveCredential(provider: SetupProvider, apiKey: string): void {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error('saveCredential: empty key');

  let existing: CredentialsFile = {};
  try {
    const raw = readFileSync(CREDENTIALS_PATH, 'utf8');
    existing = JSON.parse(raw) as CredentialsFile;
  } catch {
    // file doesn't exist or is malformed - rewrite from scratch
  }
  existing.providers ??= {};
  existing.providers[provider.name] = { apiKey: trimmed };

  mkdirSync(dirname(CREDENTIALS_PATH), { recursive: true });
  writeFileSync(CREDENTIALS_PATH, `${JSON.stringify(existing, null, 2)}\n`, { encoding: 'utf8' });
  try {
    chmodSync(CREDENTIALS_PATH, 0o600);
  } catch {
    // permissions are best-effort (e.g. on Windows)
  }
  process.env[provider.envVar] = trimmed;
}

/**
 * "Configured" = at least one of the surfaced providers has its API
 * key env var populated. Local-only adapters (ollama / claude_code /
 * codex) are deliberately ignored here because they need their host
 * binary installed and we'd rather prompt for a key than silently
 * assume a local CLI works.
 */
export function detectConfiguredProviders(): { configured: boolean; ready: string[] } {
  const ready: string[] = [];
  for (const p of SETUP_PROVIDERS) {
    if (process.env[p.envVar]) ready.push(p.name);
  }
  return { configured: ready.length > 0, ready };
}
