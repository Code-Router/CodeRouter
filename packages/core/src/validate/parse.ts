import type { ValidatorFailure } from '../types.js';

/**
 * Tool-output parsers that turn stderr/stdout into structured failures
 * the router can reason about (e.g. forbid touching X file again,
 * promote a `handoff-fix` run targeting these specific lines).
 *
 * We parse a deliberate handful (Biome, ESLint, tsc, Vitest, Pytest,
 * Mypy, Ruff). For everything else the validator records a single
 * coarse failure containing the truncated stderr.
 */

const CWD_PLACEHOLDER = '<cwd>';

function stripCwd(line: string, cwd?: string): string {
  if (!cwd) return line;
  return line.replace(cwd, CWD_PLACEHOLDER);
}

/** ESLint default text formatter: "  12:34  error  message  rule-name" */
export function parseEslint(output: string, cwd?: string): ValidatorFailure[] {
  const out: ValidatorFailure[] = [];
  let file: string | undefined;
  for (const raw of output.split('\n')) {
    const line = stripCwd(raw, cwd);
    if (/^[A-Z]?:?\/[^:]+$/.test(line.trim()) || /^\.{0,2}\/.+/.test(line)) {
      file = line.trim();
      continue;
    }
    const m = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s\s+([\w/-]+)\s*$/.exec(line);
    if (m && file) {
      out.push({
        file,
        line: Number(m[1]),
        column: Number(m[2]),
        severity: m[3] === 'error' ? 'error' : 'warning',
        message: m[4]!,
        rule: m[5]!,
      });
    }
  }
  return out;
}

/** Biome JSON-line summary format (when --reporter json is on) — fall back to text. */
export function parseBiome(output: string, cwd?: string): ValidatorFailure[] {
  const out: ValidatorFailure[] = [];
  for (const raw of output.split('\n')) {
    const line = stripCwd(raw, cwd);
    const m = /^\s*(\S+\.\w+):(\d+):(\d+)\s+(?:lint\/[\w/-]+\s+)?(.+)$/.exec(line);
    if (m) {
      out.push({
        file: m[1]!,
        line: Number(m[2]),
        column: Number(m[3]),
        severity: 'error',
        message: m[4]!,
      });
    }
  }
  return out;
}

/** tsc --noEmit: "src/foo.ts(12,34): error TS2322: ..." */
export function parseTsc(output: string, cwd?: string): ValidatorFailure[] {
  const out: ValidatorFailure[] = [];
  for (const raw of output.split('\n')) {
    const line = stripCwd(raw, cwd);
    const m = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/.exec(line);
    if (m) {
      out.push({
        file: m[1]!,
        line: Number(m[2]),
        column: Number(m[3]),
        severity: m[4] === 'error' ? 'error' : 'warning',
        rule: m[5]!,
        message: m[6]!,
      });
    }
  }
  return out;
}

/** Vitest --reporter=basic output: " FAIL  path/to/file.test.ts > test name" */
export function parseVitest(output: string, cwd?: string): ValidatorFailure[] {
  const out: ValidatorFailure[] = [];
  const failPattern = /(?:FAIL|×)\s+(\S+\.test\.\w+)(?:\s*>\s*(.+))?/g;
  let m: RegExpExecArray | null = failPattern.exec(output);
  while (m !== null) {
    out.push({
      file: stripCwd(m[1]!, cwd),
      severity: 'error',
      message: m[2] ? `failed test: ${m[2]}` : 'failed test',
    });
    m = failPattern.exec(output);
  }
  return out;
}

/** Pytest short summary: "FAILED tests/test_foo.py::test_bar - AssertionError: ..." */
export function parsePytest(output: string, cwd?: string): ValidatorFailure[] {
  const out: ValidatorFailure[] = [];
  for (const raw of output.split('\n')) {
    const line = stripCwd(raw, cwd);
    const m = /^FAILED\s+(\S+?)(?:::(\S+))?\s*-?\s*(.*)$/.exec(line);
    if (m) {
      out.push({
        file: m[1]!,
        severity: 'error',
        message: m[2] ? `${m[2]}: ${m[3] ?? ''}`.trim() : (m[3] || 'failed test'),
      });
    }
  }
  return out;
}

/** Mypy: "src/foo.py:12: error: Incompatible return value type ..." */
export function parseMypy(output: string, cwd?: string): ValidatorFailure[] {
  const out: ValidatorFailure[] = [];
  for (const raw of output.split('\n')) {
    const line = stripCwd(raw, cwd);
    const m = /^(.+?):(\d+):\s+(error|warning|note):\s+(.+)$/.exec(line);
    if (m && m[3] !== 'note') {
      out.push({
        file: m[1]!,
        line: Number(m[2]),
        severity: m[3] === 'error' ? 'error' : 'warning',
        message: m[4]!,
      });
    }
  }
  return out;
}

/** Ruff: "src/foo.py:12:34: E501 line too long" */
export function parseRuff(output: string, cwd?: string): ValidatorFailure[] {
  const out: ValidatorFailure[] = [];
  for (const raw of output.split('\n')) {
    const line = stripCwd(raw, cwd);
    const m = /^(.+?):(\d+):(\d+):\s+([A-Z]\d+)\s+(.+)$/.exec(line);
    if (m) {
      out.push({
        file: m[1]!,
        line: Number(m[2]),
        column: Number(m[3]),
        severity: 'error',
        rule: m[4]!,
        message: m[5]!,
      });
    }
  }
  return out;
}

export function parseGeneric(output: string): ValidatorFailure[] {
  if (!output.trim()) return [];
  return [
    {
      severity: 'error',
      message: output.slice(-2_000),
    },
  ];
}
