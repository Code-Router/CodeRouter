import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool } from '../types.js';
import { resolveSafe, shortPath, stringArg } from './helpers.js';

export const writeFileTool: Tool = {
  name: 'write_file',
  description:
    'Create a new file or fully overwrite an existing file with the provided content. ' +
    'Creates parent directories as needed. Prefer `edit_file` for surgical changes to existing files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Worktree-relative path.' },
      content: { type: 'string', description: 'Full file contents to write.' },
    },
    required: ['path', 'content'],
  },
  describe: (args) => `Wrote ${shortPath(stringArg(args, 'path'))}`,
  run: async (args, ctx) => {
    const path = stringArg(args, 'path');
    const content = stringArg(args, 'content');
    const abs = resolveSafe(ctx.cwd, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
    return { body: `wrote ${path} (${content.length} bytes)`, display: path, ok: true };
  },
};
