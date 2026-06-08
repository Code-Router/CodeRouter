import { readFile } from 'node:fs/promises';
import type { Tool } from '../types.js';
import { MAX_READ_BYTES, clip, resolveSafe, shortPath, stringArg } from './helpers.js';

export const readFileTool: Tool = {
  name: 'read_file',
  description:
    'Read a file from the worktree. Returns the contents prefixed with line numbers. Caps at ' +
    `${MAX_READ_BYTES} bytes; for larger files use \`grep\` to locate the section first.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Worktree-relative path to the file.' },
    },
    required: ['path'],
  },
  describe: (args) => `Read ${shortPath(stringArg(args, 'path'))}`,
  run: async (args, ctx) => {
    const path = stringArg(args, 'path');
    const abs = resolveSafe(ctx.cwd, path);
    const data = await readFile(abs, 'utf8');
    const { text, truncated } = clip(data, MAX_READ_BYTES);
    const numbered = text
      .split('\n')
      .map((line, i) => `${String(i + 1).padStart(6)}|${line}`)
      .join('\n');
    return {
      body: truncated
        ? `${numbered}\n\n[truncated: file is larger than ${MAX_READ_BYTES} bytes]`
        : numbered,
      display: `${path} (${data.length} bytes)`,
    };
  },
};
