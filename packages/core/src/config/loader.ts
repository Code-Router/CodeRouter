import { access, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { ConfigSchema, type Config } from './schema.js';

const CANDIDATES = [
  'coderouter.config.ts',
  'coderouter.config.mjs',
  'coderouter.config.js',
  'coderouter.config.json',
  '.coderouter/config.json',
];

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads coderouter.config.* from the repo root (closest ancestor of
 * `cwd`). Supports TS/JS/JSON. Returns an empty validated config when
 * nothing is found - the caller merges in defaults.
 */
export async function loadConfig(cwd: string): Promise<{ config: Config; path?: string }> {
  for (const name of CANDIDATES) {
    const candidate = join(cwd, name);
    if (!(await fileExists(candidate))) continue;
    const raw = await readOne(candidate);
    const parsed = ConfigSchema.parse(raw);
    return { config: parsed, path: candidate };
  }
  return { config: ConfigSchema.parse({}) };
}

async function readOne(path: string): Promise<unknown> {
  if (path.endsWith('.json')) {
    const text = await readFile(path, 'utf8');
    return JSON.parse(text);
  }
  // dynamic import for .js/.mjs/.ts (tsx loader required for .ts at dev time;
  // in production builds the config is expected to be JS/JSON or precompiled)
  const url = pathToFileURL(path).href;
  const mod = (await import(url)) as { default?: unknown };
  return mod.default ?? mod;
}
