import { stat } from 'node:fs/promises';
import { exec } from '../../sandbox/exec.js';
import type { Tool, ToolContext } from '../types.js';
import { MAX_GLOB_RESULTS, escapeShellArg, quoted, stringArg } from './helpers.js';

export const globTool: Tool = {
  name: 'glob',
  description:
    'List files matching a glob pattern, relative to the worktree root. ' +
    'Patterns are POSIX-style (e.g. `**/*.ts`, `src/**/*.{js,jsx}`). ' +
    `Capped at ${MAX_GLOB_RESULTS} results.`,
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern.' },
    },
    required: ['pattern'],
  },
  describe: (args) => `Listed files matching ${quoted(stringArg(args, 'pattern'))}`,
  run: async (args, ctx) => {
    const pattern = stringArg(args, 'pattern');
    const matches = await runGlob(ctx, pattern);
    const head = matches.slice(0, MAX_GLOB_RESULTS);
    const more = matches.length > head.length ? `\n... +${matches.length - head.length} more` : '';
    return {
      body: head.length > 0 ? `${head.join('\n')}${more}` : '(no matches)',
      display: `${matches.length} match${matches.length === 1 ? '' : 'es'}`,
    };
  },
};

async function runGlob(ctx: ToolContext, pattern: string): Promise<string[]> {
  // Prefer git ls-files when we're inside a repo - it respects
  // .gitignore so the model doesn't waste a turn reading
  // node_modules. Fall back to find for non-git worktrees.
  if (await isGitRepo(ctx.cwd)) {
    const { stdout } = await exec(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', pattern],
      { cwd: ctx.cwd, signal: ctx.signal },
    );
    return stdout.split('\n').filter(Boolean);
  }
  const { stdout } = await exec(
    '/bin/sh',
    [
      '-lc',
      `find . -path ${escapeShellArg(pattern)} -type f -not -path '*/.*' | head -n 1000`,
    ],
    { cwd: ctx.cwd, signal: ctx.signal },
  );
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((p) => (p.startsWith('./') ? p.slice(2) : p));
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const s = await stat(`${cwd}/.git`);
    return s.isDirectory() || s.isFile();
  } catch {
    return false;
  }
}
