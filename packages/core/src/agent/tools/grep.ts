import { exec } from '../../sandbox/exec.js';
import { whichSync } from '../../sandbox/which.js';
import type { Tool, ToolContext, ToolResult } from '../types.js';
import { MAX_GREP_BYTES, clip, quoted, shortPath, stringArg } from './helpers.js';

export const grepTool: Tool = {
  name: 'grep',
  description:
    'Search file contents with a regex pattern, ripgrep-style. Returns matching lines ' +
    'with file:line:text format. Use `path` to scope the search. ' +
    `Capped at ${MAX_GREP_BYTES} bytes of output.`,
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern.' },
      path: { type: 'string', description: 'Optional sub-path to search within.' },
      type: {
        type: 'string',
        description: 'Optional file type filter (e.g. `js`, `py`, `rust`). Maps to ripgrep --type.',
      },
      ignore_case: { type: 'boolean', description: 'Case-insensitive search.' },
    },
    required: ['pattern'],
  },
  describe: (args) => {
    const path = typeof args.path === 'string' ? args.path : undefined;
    const inPart = path ? ` in ${shortPath(path)}` : '';
    return `Searched ${quoted(stringArg(args, 'pattern'))}${inPart}`;
  },
  run: async (args, ctx) => {
    return runGrep(ctx, {
      pattern: stringArg(args, 'pattern'),
      path: typeof args.path === 'string' ? args.path : undefined,
      type: typeof args.type === 'string' ? args.type : undefined,
      ignoreCase: Boolean(args.ignore_case),
    });
  },
};

async function runGrep(
  ctx: ToolContext,
  args: { pattern: string; path?: string; type?: string; ignoreCase: boolean },
): Promise<ToolResult> {
  const rg = whichSync('rg');
  if (rg) {
    const rgArgs: string[] = ['--line-number', '--no-heading', '--color=never'];
    if (args.ignoreCase) rgArgs.push('-i');
    if (args.type) rgArgs.push('--type', args.type);
    rgArgs.push('--', args.pattern);
    // Pass an explicit path: when stdin is a pipe (which it is
    // under `exec`) ripgrep otherwise blocks reading from stdin
    // instead of recursing into cwd.
    rgArgs.push(args.path ?? '.');
    const { stdout, exitCode } = await exec('rg', rgArgs, {
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    if (exitCode !== 0 && exitCode !== 1) {
      return { body: `(rg exit ${exitCode})`, ok: false, display: 'error' };
    }
    return formatGrep(stdout);
  }
  // grep -RInE fallback. Loses --type semantics but covers the common case.
  const grepArgs: string[] = ['-RInE'];
  if (args.ignoreCase) grepArgs.push('-i');
  grepArgs.push('--', args.pattern, args.path ?? '.');
  const { stdout, exitCode } = await exec('grep', grepArgs, {
    cwd: ctx.cwd,
    signal: ctx.signal,
  });
  if (exitCode !== 0 && exitCode !== 1) {
    return { body: `(grep exit ${exitCode})`, ok: false, display: 'error' };
  }
  return formatGrep(stdout);
}

function formatGrep(stdout: string): ToolResult {
  const { text, truncated } = clip(stdout, MAX_GREP_BYTES);
  const lines = text.split('\n').filter(Boolean);
  return {
    body: lines.length > 0 ? `${text}${truncated ? '\n[truncated]' : ''}` : '(no matches)',
    display: `${lines.length} match${lines.length === 1 ? '' : 'es'}`,
    ok: true,
  };
}
