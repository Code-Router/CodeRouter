import type { Effort, Mode } from '@coderouter/core';
import { executeRun } from '../runtime.js';
import { printReport } from '../ui/report.js';
import { askForRating } from '../ui/rating.js';

export type OnceOpts = {
  prompt: string;
  mode?: string;
  effort?: string;
  fast?: boolean;
  apply?: boolean;
  route?: string;
  cwd?: string;
  json?: boolean;
};

export async function runOnceCommand(opts: OnceOpts): Promise<void> {
  if (!opts.prompt?.trim()) {
    process.stderr.write('error: prompt is required\n');
    process.exit(2);
  }
  const mode = (opts.mode ?? 'agent') as Mode;
  const effort = opts.effort as Effort | undefined;
  const { report, output, store } = await executeRun({
    prompt: opts.prompt,
    cwd: opts.cwd ?? process.cwd(),
    mode,
    effort,
    fast: opts.fast,
    apply: opts.apply,
    route: opts.route,
    json: opts.json,
  });
  printReport(report, { json: opts.json });
  if (mode === 'agent' && output.status === 'success' && !opts.json) {
    const rating = await askForRating();
    if (rating !== 0) {
      try {
        store.runs.setRating(output.runId, rating);
      } catch {
        // rating storage is best-effort
      }
    }
  }
  try {
    store.db.close();
  } catch {
    // ignore
  }
}
