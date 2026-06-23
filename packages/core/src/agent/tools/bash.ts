import { exec, shellInvocation } from '../../sandbox/exec.js';
import type { Tool } from '../types.js';
import { MAX_BASH_OUTPUT_BYTES, clip, oneLine, stringArg } from './helpers.js';

export const bashTool: Tool = {
  name: 'bash',
  description:
    'Run a shell command in the worktree. Returns combined stdout/stderr and exit code. ' +
    'The directory is already trusted (the user opted in at session start), so commands ' +
    'run without per-call confirmation - keep them small and read-only when possible. ' +
    'Use `timeout_ms` to bound long-running commands.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'Shell command to execute. Runs via the system shell (sh on macOS/Linux, cmd.exe on Windows).',
      },
      timeout_ms: {
        type: 'integer',
        description: 'Hard timeout in milliseconds. Defaults to 60000.',
      },
    },
    required: ['command'],
  },
  describe: (args) => `Ran ${oneLine(stringArg(args, 'command'), 100)}`,
  run: async (args, ctx) => {
    const command = stringArg(args, 'command');
    const timeoutMs =
      typeof args.timeout_ms === 'number' && args.timeout_ms > 0 ? args.timeout_ms : 60_000;
    const { cmd, args: shArgs } = shellInvocation(command, { login: true });
    const result = await exec(cmd, shArgs, {
      cwd: ctx.cwd,
      signal: ctx.signal,
      timeoutMs,
    });
    const { text: stdout, truncated: stdoutTrunc } = clip(result.stdout, MAX_BASH_OUTPUT_BYTES);
    const { text: stderr, truncated: stderrTrunc } = clip(result.stderr, MAX_BASH_OUTPUT_BYTES);
    const parts: string[] = [`exit code: ${result.exitCode}`];
    if (stdout) parts.push(`---- stdout ----\n${stdout}${stdoutTrunc ? '\n[truncated]' : ''}`);
    if (stderr) parts.push(`---- stderr ----\n${stderr}${stderrTrunc ? '\n[truncated]' : ''}`);
    return {
      body: parts.join('\n'),
      ok: result.exitCode === 0,
      display: result.exitCode === 0 ? 'ok' : `exit ${result.exitCode}`,
    };
  },
};
