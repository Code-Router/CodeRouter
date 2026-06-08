import { exec } from '../../sandbox/exec.js';
import type { Tool } from '../types.js';
import { resolveSafe, shortPath } from './helpers.js';

export const listDirTool: Tool = {
  name: 'list_dir',
  description: 'List entries (files + subdirectories) of a directory in the worktree.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Worktree-relative path. Defaults to ".".' },
    },
  },
  describe: (args) => `Listed ${shortPath(typeof args.path === 'string' ? args.path : '.')}`,
  run: async (args, ctx) => {
    const path = typeof args.path === 'string' ? args.path : '.';
    const abs = resolveSafe(ctx.cwd, path);
    const { stdout } = await exec('ls', ['-1A', abs], { cwd: ctx.cwd, signal: ctx.signal });
    const lines = stdout.split('\n').filter(Boolean);
    return {
      body: lines.length > 0 ? lines.join('\n') : '(empty)',
      display: `${lines.length} entr${lines.length === 1 ? 'y' : 'ies'}`,
    };
  },
};
