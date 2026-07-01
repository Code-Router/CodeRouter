/**
 * Command gating for the `allowlist` run mode.
 *
 * This is a pragmatic, best-effort guard - NOT a security sandbox. It lets
 * the common build / test / run / scaffolding commands through while
 * refusing obviously destructive or system-level ones. Users who want no
 * gating pick `unsandboxed`; users who want hard isolation pick `sandboxed`.
 */

/** Leading commands permitted in allowlist mode (matched on the first token). */
const ALLOWED_COMMANDS = new Set<string>([
  // JS / TS toolchain
  'node', 'npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx', 'deno',
  'tsc', 'tsx', 'ts-node', 'vite', 'next', 'nuxt', 'astro', 'remix',
  'jest', 'vitest', 'mocha', 'eslint', 'prettier', 'biome', 'webpack', 'rollup', 'esbuild',
  'http-server', 'serve', 'live-server',
  // Python
  'python', 'python3', 'pip', 'pip3', 'pipx', 'poetry', 'uv', 'pytest', 'ruff', 'black', 'flake8', 'mypy', 'django-admin', 'flask', 'uvicorn', 'gunicorn',
  // other languages / build tools
  'go', 'cargo', 'rustc', 'make', 'cmake', 'ruby', 'rails', 'bundle', 'rake', 'gem',
  'php', 'composer', 'java', 'javac', 'gradle', './gradlew', 'gradlew', 'mvn', 'dotnet',
  // git (read + normal write ops; destructive ones are caught by the denylist)
  'git',
  // read-only / safe file + shell utilities
  'ls', 'cat', 'echo', 'pwd', 'cd', 'mkdir', 'touch', 'cp', 'mv', 'ln',
  'grep', 'rg', 'find', 'fd', 'sed', 'awk', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr',
  'which', 'env', 'printenv', 'date', 'true', 'false', 'test', 'diff', 'tree', 'file', 'stat',
  'tar', 'unzip', 'zip', 'gzip', 'gunzip',
]);

/**
 * Patterns that are refused outright regardless of the leading command
 * (destructive, privilege-escalating, or pipe-to-shell).
 */
const DENIED_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i, // rm -rf / rm -f / rm -r
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /:\(\)\s*\{/, // fork bomb
  /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i, // curl ... | sh
  /\bgit\s+(push|reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|rebase)\b/i,
  />\s*\/dev\/sd[a-z]/i,
];

export type CommandDecision = { allowed: true } | { allowed: false; reason: string };

/** Split a compound command into rough segments by shell operators. */
function segments(command: string): string[] {
  return command
    .split(/&&|\|\||[;\n|]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** First bareword token of a segment (skips leading env-var assignments). */
function leadingCommand(segment: string): string {
  const tokens = segment.split(/\s+/).filter(Boolean);
  let i = 0;
  // Skip `FOO=bar` style env prefixes.
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i] ?? '')) i += 1;
  return tokens[i] ?? '';
}

/**
 * Decide whether a command may run under allowlist mode. Refuses on any
 * denied pattern, then requires every segment's leading command to be in
 * the allowlist.
 */
export function evaluateCommand(command: string): CommandDecision {
  const trimmed = command.trim();
  if (!trimmed) return { allowed: false, reason: 'empty command' };

  for (const pat of DENIED_PATTERNS) {
    if (pat.test(trimmed)) {
      return {
        allowed: false,
        reason:
          'blocked by allowlist run mode: this command looks destructive or privileged. ' +
          'Switch Run Mode to "Run everything" in Settings to allow it.',
      };
    }
  }

  for (const seg of segments(trimmed)) {
    const lead = leadingCommand(seg);
    if (!lead) continue;
    // Normalize a path-qualified binary (e.g. ./node_modules/.bin/vite) to its basename.
    const base = lead.includes('/') ? (lead.split('/').pop() ?? lead) : lead;
    if (!ALLOWED_COMMANDS.has(lead) && !ALLOWED_COMMANDS.has(base)) {
      return {
        allowed: false,
        reason:
          `blocked by allowlist run mode: '${lead}' is not in the allowed command list. ` +
          'Allowed: package managers, language runtimes, build/test/lint tools, git, and common file utilities. ' +
          'Switch Run Mode to "Run everything" in Settings to allow arbitrary commands.',
      };
    }
  }

  return { allowed: true };
}
