/**
 * Progress notifier shared by all modes.
 *
 * CLI: renders @clack/prompts spinners ('[2/6] GitHub code search ... done')
 * MCP: emits `progress` capability notifications when the host supports them.
 *
 * The core never imports a UI library; it speaks through this typed
 * callback so the same modes work in either rendering target.
 */

export type ProgressUpdate = {
  phase: string;
  stage: 'start' | 'progress' | 'done' | 'error';
  message?: string;
  /** Phase index, 1-based. */
  index?: number;
  /** Total phases. */
  total?: number;
  /** Free-form data the renderer can ignore or surface. */
  data?: Record<string, unknown>;
};

export type ProgressNotifier = (u: ProgressUpdate) => void;

export const noopProgress: ProgressNotifier = () => {};
