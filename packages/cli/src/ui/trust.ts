import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

/**
 * Directory-trust persistence. Mirrors how Cursor and Claude Code
 * gate first-time access to a folder: the user is prompted once
 * per directory, the answer is stored locally, and we don't ask
 * again unless they explicitly revoke.
 *
 * Stored at `~/.coderouter/trust.json` with mode 0600. Format:
 *   { "trustedDirs": ["/abs/path/one", "/abs/path/two"] }
 *
 * Paths are stored absolute (no symlink resolution) so a `cd` into
 * a different mount of the same physical directory still prompts -
 * which is the safer default for a local-binary-running agent.
 */

const TRUST_PATH = `${homedir()}/.coderouter/trust.json`;

type TrustData = {
  trustedDirs: string[];
};

function loadTrust(): TrustData {
  if (!existsSync(TRUST_PATH)) return { trustedDirs: [] };
  try {
    const parsed = JSON.parse(readFileSync(TRUST_PATH, 'utf8')) as TrustData;
    if (!Array.isArray(parsed.trustedDirs)) return { trustedDirs: [] };
    return { trustedDirs: parsed.trustedDirs.map((p) => String(p)) };
  } catch {
    return { trustedDirs: [] };
  }
}

function saveTrust(data: TrustData): void {
  mkdirSync(dirname(TRUST_PATH), { recursive: true });
  writeFileSync(TRUST_PATH, JSON.stringify(data, null, 2), 'utf8');
  try {
    chmodSync(TRUST_PATH, 0o600);
  } catch {
    // chmod is best-effort: on Windows it's a no-op
  }
}

export const TRUST_FILE_PATH = TRUST_PATH;

export function isDirectoryTrusted(dir: string): boolean {
  const abs = resolve(dir);
  return loadTrust().trustedDirs.includes(abs);
}

export function trustDirectory(dir: string): void {
  const abs = resolve(dir);
  const data = loadTrust();
  if (!data.trustedDirs.includes(abs)) {
    data.trustedDirs.push(abs);
    saveTrust(data);
  }
}

export function untrustDirectory(dir: string): void {
  const abs = resolve(dir);
  const data = loadTrust();
  const next = data.trustedDirs.filter((p) => p !== abs);
  if (next.length !== data.trustedDirs.length) {
    saveTrust({ trustedDirs: next });
  }
}
