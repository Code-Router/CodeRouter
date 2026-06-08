import { readFile, writeFile } from 'node:fs/promises';
import type { Tool } from '../types.js';
import { applyReplace, resolveSafe, shortPath, stringArg } from './helpers.js';

export const editFileTool: Tool = {
  name: 'edit_file',
  description:
    'Replace exactly one occurrence of `old_string` with `new_string` in the named file. ' +
    'The match is exact and must be unique in the file (or pass `replace_all: true` to ' +
    'replace every occurrence). Preserves indentation and surrounding lines as-is.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Worktree-relative path.' },
      old_string: {
        type: 'string',
        description: 'Exact text to replace (include enough context to be unique).',
      },
      new_string: { type: 'string', description: 'Replacement text.' },
      replace_all: {
        type: 'boolean',
        description: 'Replace every occurrence instead of requiring exactly one.',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  describe: (args) => `Edited ${shortPath(stringArg(args, 'path'))}`,
  run: async (args, ctx) => {
    const path = stringArg(args, 'path');
    const oldStr = stringArg(args, 'old_string');
    const newStr = stringArg(args, 'new_string');
    const replaceAll = Boolean(args.replace_all);
    const abs = resolveSafe(ctx.cwd, path);
    const original = await readFile(abs, 'utf8');
    const next = applyReplace(original, oldStr, newStr, replaceAll, 'edit_file');
    await writeFile(abs, next, 'utf8');
    return { body: `edited ${path}`, display: path, ok: true };
  },
};
