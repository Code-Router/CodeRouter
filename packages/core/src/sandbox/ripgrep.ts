import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
import { whichSync } from './which.js';

/**
 * Resolve a usable ripgrep (`rg`) binary, preferring the one we bundle.
 *
 * Order:
 *   1. `@vscode/ripgrep` - a prebuilt, per-platform `rg` shipped as an
 *      npm dependency (the same binary VS Code / Cursor use). This is
 *      always present after `npm install`, so users don't have to
 *      install ripgrep themselves.
 *   2. A standalone `rg` on PATH - lets power users override with a
 *      newer / faster build.
 *   3. `null` - no ripgrep anywhere; callers must degrade gracefully
 *      (the context scanner returns no matches; the grep tool falls
 *      back to `grep`).
 *
 * Memoised: neither the bundled path nor PATH changes within a process.
 */
let cached: string | null | undefined;

export function resolveRipgrep(): string | null {
  if (cached !== undefined) return cached;
  cached = bundledRipgrep() ?? whichSync('rg');
  return cached;
}

function bundledRipgrep(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const { rgPath } = require('@vscode/ripgrep') as { rgPath?: string };
    if (rgPath && statSync(rgPath).isFile()) return rgPath;
  } catch {
    // Dependency not installed or binary missing for this platform -
    // fall through to the PATH lookup.
  }
  return null;
}

/** Test seam: reset the memoised lookup so tests can re-resolve. */
export function resetRipgrepCache(): void {
  cached = undefined;
}
