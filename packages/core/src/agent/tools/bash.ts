import { exec, execBackground, shellInvocation } from '../../sandbox/exec.js';
import type { Tool } from '../types.js';
import { evaluateCommand } from './commandPolicy.js';
import { MAX_BASH_OUTPUT_BYTES, clip, oneLine, stringArg } from './helpers.js';

/** Pull the first local server URL out of a process's early output. */
function detectServerUrl(output: string): string | undefined {
  // Explicit URL (Vite "Local: http://localhost:5173/", Next, CRA, etc).
  const m = output.match(
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?(?:\/\S*)?/i,
  );
  if (m) {
    // Non-browsable bind addresses -> localhost.
    return m[0].replace('0.0.0.0', 'localhost').replace(/\[::1?\]/, 'localhost');
  }
  // Fallback: "... port 8000" banners (e.g. python -m http.server) where the
  // host is an unbrowsable wildcard like :: -> assume localhost.
  const port = output.match(/\bport\s+(\d{2,5})\b/i);
  if (port) return `http://localhost:${port[1]}`;
  return undefined;
}

export const bashTool: Tool = {
  name: 'bash',
  description:
    'Run a shell command in the project directory. Returns combined stdout/stderr and exit code. ' +
    'The directory is already trusted (the user opted in at session start), so commands ' +
    'run without per-call confirmation. ' +
    'Set `background: true` to start a long-running process (dev server, watcher) that keeps ' +
    'running after this call returns - use it for `npm run dev`, `python -m http.server`, etc. ' +
    'A local server URL is auto-detected and shown to the user with an "Open in browser" button, ' +
    'so you do NOT need a browser yourself; just start the server in the background and tell the ' +
    'user it is ready. Use `timeout_ms` to bound foreground commands.',
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
        description: 'Hard timeout in milliseconds for foreground commands. Defaults to 60000.',
      },
      background: {
        type: 'boolean',
        description:
          'Run as a persistent background process that outlives this call (dev servers, watchers). ' +
          'Returns immediately with the pid and any detected local URL instead of waiting for exit.',
      },
    },
    required: ['command'],
  },
  describe: (args) =>
    args.background === true
      ? `Started ${oneLine(stringArg(args, 'command'), 100)}`
      : `Ran ${oneLine(stringArg(args, 'command'), 100)}`,
  run: async (args, ctx) => {
    const command = stringArg(args, 'command');

    // Allowlist run mode: refuse commands outside the safe set before we
    // spawn anything. Other modes (sandboxed / unsandboxed) run unrestricted.
    if (ctx.runMode === 'allowlist') {
      const decision = evaluateCommand(command);
      if (!decision.allowed) {
        return { body: decision.reason, ok: false, display: 'blocked' };
      }
    }

    const { cmd, args: shArgs } = shellInvocation(command, { login: true });

    if (args.background === true) {
      // PYTHONUNBUFFERED so `python -m http.server` (and friends) flush their
      // "Serving on ..." banner promptly instead of buffering it out of the
      // URL-detection window; harmless for non-Python processes.
      const proc = execBackground(cmd, shArgs, { cwd: ctx.cwd, env: { PYTHONUNBUFFERED: '1' } });
      await proc.settled;
      const early = proc.output();
      const url = detectServerUrl(early);
      ctx.onActivity?.({
        kind: 'process_started',
        pid: proc.pid,
        command,
        cwd: ctx.cwd,
        url,
      });
      const { text: out } = clip(early, MAX_BASH_OUTPUT_BYTES);
      const parts = [
        `Started background process (pid ${proc.pid}).`,
        url ? `Detected local URL: ${url} (the user can open it in their browser).` : undefined,
        out ? `---- early output ----\n${out}` : undefined,
      ].filter(Boolean) as string[];
      return { body: parts.join('\n'), ok: proc.pid > 0, display: url ? `pid ${proc.pid} · ${url}` : `pid ${proc.pid}` };
    }

    const timeoutMs =
      typeof args.timeout_ms === 'number' && args.timeout_ms > 0 ? args.timeout_ms : 60_000;
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
