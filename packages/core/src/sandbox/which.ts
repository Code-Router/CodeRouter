import { statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const WINDOWS_EXTS = ['.exe', '.cmd', '.bat'];

/**
 * Synchronous PATH lookup for a binary. Returns the resolved absolute
 * path or null when the binary isn't on PATH (or isn't executable on
 * Unix). Mirrors the subset of `which(1)` we actually need: no shims,
 * no aliases, no `-a`.
 *
 * Used by `ProviderRegistry.isReady` so we can honestly say whether a
 * local-CLI provider (`codex`, `claude_code`, `ollama`) is usable
 * before the router tries to route to it.
 */
export function whichSync(bin: string): string | null {
  if (!bin) return null;
  // Absolute or relative paths bypass PATH entirely.
  if (bin.includes('/') || bin.includes('\\')) {
    return isExecutableFile(bin) ? bin : null;
  }
  const path = process.env.PATH ?? '';
  if (!path) return null;
  const dirs = path.split(delimiter).filter(Boolean);
  const candidates =
    process.platform === 'win32' ? [bin, ...WINDOWS_EXTS.map((e) => bin + e)] : [bin];
  for (const dir of dirs) {
    for (const c of candidates) {
      const p = join(dir, c);
      if (isExecutableFile(p)) return p;
    }
  }
  return null;
}

function isExecutableFile(p: string): boolean {
  try {
    const st = statSync(p);
    if (!st.isFile()) return false;
    // On Windows the mode check is unreliable; rely on .exe/.cmd suffix
    // (already filtered upstream).
    if (process.platform === 'win32') return true;
    return (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
