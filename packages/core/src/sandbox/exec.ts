import { spawn } from 'node:child_process';

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

export type ExecOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Optional callback invoked with every stdout chunk as it arrives.
   * The chunk is a UTF-8 string (already decoded). Used by adapters
   * that want to stream tokens to the UI rather than wait for the
   * full subprocess to exit. The final accumulated stdout is still
   * returned in the resolved ExecResult.
   */
  onStdout?: (chunk: string) => void;
  /** Same as onStdout but for stderr. */
  onStderr?: (chunk: string) => void;
};

/**
 * Promise-based subprocess wrapper. Captures stdout/stderr fully (no
 * streaming); used by sandbox/validate/adapters where command output is
 * small and structured. For streaming subprocess work, prefer the dedicated
 * adapter implementations that stream tokens.
 */
export async function exec(
  cmd: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: opts.signal,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          killed = true;
          child.kill('SIGKILL');
        }, opts.timeoutMs)
      : null;

    child.stdout.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      stdout += s;
      opts.onStdout?.(s);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      stderr += s;
      opts.onStderr?.(s);
    });

    child.on('error', (err: Error) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (timeout) clearTimeout(timeout);
      const exitCode = code ?? (signal ? 128 : -1);
      resolve({
        stdout,
        stderr: killed ? `${stderr}\n[killed after ${opts.timeoutMs}ms]` : stderr,
        exitCode,
        durationMs: performance.now() - start,
      });
    });

    if (opts.input !== undefined) {
      child.stdin.end(opts.input);
    } else {
      child.stdin.end();
    }
  });
}

export async function git(
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  return exec('git', args, opts);
}

export class CommandError extends Error {
  constructor(
    message: string,
    public readonly result: ExecResult,
    public readonly cmd: string,
    public readonly args: string[],
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export async function gitOrThrow(
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const result = await git(args, opts);
  if (result.exitCode !== 0) {
    throw new CommandError(
      `git ${args.join(' ')} failed (exit ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
      result,
      'git',
      args,
    );
  }
  return result;
}
