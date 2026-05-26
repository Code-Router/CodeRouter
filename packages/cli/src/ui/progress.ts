import type { ProgressNotifier } from '@coderouter/core';
import { c } from './colors.js';
import { createSpinner, type Spinner } from './spinner.js';

/**
 * Adapts CodeRouter's UI-agnostic ProgressNotifier interface to a single
 * terminal spinner that updates as phases progress.
 */
export function spinnerProgress(): { notifier: ProgressNotifier; close(): void } {
  let spinner: Spinner | undefined;
  let currentPhase = '';

  const notifier: ProgressNotifier = (update) => {
    const { phase, stage } = update;
    if (phase !== currentPhase) {
      if (spinner) spinner.stop();
      spinner = createSpinner(c.muted(formatPhase(phase)));
      spinner.start();
      currentPhase = phase;
    } else if (spinner) {
      const detail = update.message ? c.muted(` - ${update.message}`) : '';
      spinner.setText(`${c.muted(formatPhase(phase))} ${c.muted(stage)}${detail}`);
    }
    if (stage === 'done' && spinner) {
      spinner.succeed(c.muted(`${formatPhase(phase)} done`));
      spinner = undefined;
      currentPhase = '';
    }
    if (stage === 'error' && spinner) {
      spinner.fail(c.err(`${formatPhase(phase)} failed`));
      spinner = undefined;
      currentPhase = '';
    }
  };

  return {
    notifier,
    close() {
      if (spinner) spinner.stop();
    },
  };
}

function formatPhase(phase: string): string {
  return phase.replace(/^[a-z]+\//, '').replace(/_/g, ' ');
}
