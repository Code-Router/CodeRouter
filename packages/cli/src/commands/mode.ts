import type { Mode } from '@coderouter/core';
import { runOnceCommand } from './once.js';
import { runReplCommand } from './repl.js';

export type ModeOpts = {
  prompt?: string;
  effort?: string;
  fast?: boolean;
  apply?: boolean;
  cwd?: string;
  json?: boolean;
};

export async function runModeCommand(mode: Mode, opts: ModeOpts): Promise<void> {
  if (opts.prompt && opts.prompt.trim().length > 0) {
    await runOnceCommand({ ...opts, mode, prompt: opts.prompt });
    return;
  }
  // No prompt -> enter REPL pre-bound to this mode
  await runReplCommand({ cwd: opts.cwd ?? process.cwd(), initialMode: mode });
}
