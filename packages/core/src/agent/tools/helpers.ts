/**
 * Shared helpers for the tool implementations.
 *
 * Path safety, output clipping, shell escaping, type coercion -
 * each tool re-uses these so the rules stay consistent (e.g.
 * "no path can escape the worktree" applies everywhere, not just
 * to read_file).
 */

import { isAbsolute, relative, resolve as resolvePath } from 'node:path';
import type { ToolArgs } from '../types.js';

/** Hard cap on what a single Read returns (bytes). */
export const MAX_READ_BYTES = 64 * 1024;
/** Hard cap on grep stdout (bytes). */
export const MAX_GREP_BYTES = 32 * 1024;
/** Hard cap on glob result count. */
export const MAX_GLOB_RESULTS = 200;
/** Hard cap on bash stdout/stderr each (bytes). */
export const MAX_BASH_OUTPUT_BYTES = 32 * 1024;

/**
 * Resolve a possibly-relative path against the agent's cwd,
 * refusing absolute paths or any traversal that escapes the
 * worktree. Treats `cwd` as the security boundary.
 */
export function resolveSafe(cwd: string, p: string): string {
  const abs = isAbsolute(p) ? p : resolvePath(cwd, p);
  const rel = relative(cwd, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`path '${p}' is outside the worktree`);
  }
  return abs;
}

/** Truncate a string to a byte budget. Returns whether it was clipped. */
export function clip(s: string, max: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(s, 'utf8');
  if (buf.byteLength <= max) return { text: s, truncated: false };
  return { text: buf.subarray(0, max).toString('utf8'), truncated: true };
}

/** Coerce a tool arg to a string or throw a useful error. */
export function stringArg(args: ToolArgs, key: string): string {
  const v = args[key];
  if (typeof v !== 'string') {
    throw new Error(`expected string argument '${key}', got ${typeof v}`);
  }
  return v;
}

/** POSIX shell escape (single-quoted). */
export function escapeShellArg(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Trim a path for the activity feed. Keeps last 3 segments for deep paths. */
export function shortPath(p: string): string {
  const parts = p.split('/');
  if (parts.length <= 4) return p;
  return `.../${parts.slice(-3).join('/')}`;
}

/** Single-line, length-capped form of a string for the activity feed. */
export function oneLine(s: string, max = 120): string {
  const compact = s.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}...`;
}

/** Wrap a string in single quotes for human-friendly display. */
export function quoted(s: string): string {
  return `'${s}'`;
}

/**
 * Apply an exact-string replacement with the same semantics as the
 * `edit_file` tool: must be unique unless `replaceAll` is set.
 * Shared between edit_file and multi_edit so the behaviour stays
 * identical.
 */
export function applyReplace(
  source: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean,
  label: string,
): string {
  if (oldStr.length === 0) {
    throw new Error(`${label}: \`old_string\` must be non-empty`);
  }
  if (replaceAll) {
    if (!source.includes(oldStr)) {
      throw new Error(`${label}: \`old_string\` not found`);
    }
    return source.split(oldStr).join(newStr);
  }
  const first = source.indexOf(oldStr);
  if (first < 0) {
    throw new Error(`${label}: \`old_string\` not found`);
  }
  const second = source.indexOf(oldStr, first + 1);
  if (second >= 0) {
    throw new Error(
      `${label}: \`old_string\` matches multiple times - include more surrounding context to make it unique, or pass \`replace_all: true\``,
    );
  }
  return source.slice(0, first) + newStr + source.slice(first + oldStr.length);
}
