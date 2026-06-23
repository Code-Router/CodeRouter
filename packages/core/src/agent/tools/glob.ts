import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { exec } from '../../sandbox/exec.js';
import type { Tool, ToolContext } from '../types.js';
import { MAX_GLOB_RESULTS, quoted, stringArg } from './helpers.js';

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
  // Non-git worktree: walk the tree in Node (cross-platform; no reliance on a
  // POSIX `find`, which doesn't exist on Windows) and match the glob ourselves.
  const all = await walkFiles(ctx.cwd);
  const rx = globToRegExp(pattern);
  return all.filter((p) => rx.test(p)).slice(0, 1000);
}

/** Recursively list files relative to `root`, skipping dotfiles and node_modules. */
async function walkFiles(root: string, max = 5000): Promise<string[]> {
  const out: string[] = [];
  const rec = async (dir: string): Promise<void> => {
    if (out.length >= max) return;
    const entries: Dirent[] = await readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await rec(full);
      } else if (e.isFile()) {
        out.push(relative(root, full).split(sep).join('/'));
        if (out.length >= max) return;
      }
    }
  };
  await rec(root);
  return out;
}

/** Convert a POSIX-style glob (`**`, `*`, `?`, `{a,b}`) to an anchored RegExp. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === '*') {
      if (glob.charAt(i + 1) === '*') {
        re += '.*';
        i++;
        if (glob.charAt(i + 1) === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      re += '(';
    } else if (c === '}') {
      re += ')';
    } else if (c === ',') {
      re += '|';
    } else if ('.+^$()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const s = await stat(`${cwd}/.git`);
    return s.isDirectory() || s.isFile();
  } catch {
    return false;
  }
}
