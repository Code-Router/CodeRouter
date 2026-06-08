import { readFile, writeFile } from 'node:fs/promises';
import type { Tool } from '../types.js';
import { applyReplace, resolveSafe, shortPath, stringArg } from './helpers.js';

export const multiEditTool: Tool = {
  name: 'multi_edit',
  description:
    'Apply a sequence of `edit_file`-style replacements to a single file in order. ' +
    'Atomic: if any edit fails to match, no edits are applied. Cheaper than ' +
    'multiple round trips when you have a batch of related changes.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Worktree-relative path.' },
      edits: {
        type: 'array',
        description: 'Sequence of edits to apply.',
        items: {
          type: 'object',
          properties: {
            old_string: { type: 'string' },
            new_string: { type: 'string' },
            replace_all: { type: 'boolean' },
          },
          required: ['old_string', 'new_string'],
        },
      },
    },
    required: ['path', 'edits'],
  },
  describe: (args) => {
    const edits = args.edits as unknown[] | undefined;
    const n = Array.isArray(edits) ? edits.length : 0;
    return `Edited ${shortPath(stringArg(args, 'path'))} (${n} change${n === 1 ? '' : 's'})`;
  },
  run: async (args, ctx) => {
    const path = stringArg(args, 'path');
    const editsRaw = args.edits;
    if (!Array.isArray(editsRaw) || editsRaw.length === 0) {
      throw new Error('multi_edit: `edits` must be a non-empty array');
    }
    const abs = resolveSafe(ctx.cwd, path);
    const original = await readFile(abs, 'utf8');
    let next = original;
    for (let i = 0; i < editsRaw.length; i++) {
      const e = editsRaw[i] as Record<string, unknown> | null;
      if (!e || typeof e !== 'object') {
        throw new Error(`multi_edit: edit #${i + 1} is not an object`);
      }
      const oldStr = typeof e.old_string === 'string' ? e.old_string : '';
      const newStr = typeof e.new_string === 'string' ? e.new_string : '';
      const replaceAll = Boolean(e.replace_all);
      next = applyReplace(next, oldStr, newStr, replaceAll, `multi_edit edit #${i + 1}`);
    }
    await writeFile(abs, next, 'utf8');
    return {
      body: `applied ${editsRaw.length} edit(s) to ${path}`,
      display: `${path} (${editsRaw.length} edits)`,
      ok: true,
    };
  },
};
