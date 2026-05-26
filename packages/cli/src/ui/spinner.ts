import { SYMBOLS } from '../branding/index.js';
import { c } from './colors.js';

/**
 * Minimal terminal spinner. Falls back to a static glyph when stdout is
 * not a TTY (e.g. piped to a file or run from CI).
 */
export type Spinner = {
  start(): void;
  setText(text: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
};

export function createSpinner(initialText: string): Spinner {
  const isTty = process.stdout.isTTY;
  let frame = 0;
  let text = initialText;
  let timer: NodeJS.Timeout | undefined;

  function render(symbol: string, color: (s: string) => string = c.primaryDim) {
    if (!isTty) {
      process.stdout.write(`${symbol} ${text}\n`);
      return;
    }
    process.stdout.write(`\r\x1b[2K${color(symbol)} ${text}`);
  }

  return {
    start() {
      if (!isTty) {
        render(SYMBOLS.thinking);
        return;
      }
      timer = setInterval(() => {
        render(SYMBOLS.spinner[frame % SYMBOLS.spinner.length] ?? SYMBOLS.thinking);
        frame += 1;
      }, 80);
    },
    setText(next: string) {
      text = next;
    },
    succeed(next?: string) {
      if (timer) clearInterval(timer);
      if (next) text = next;
      render(SYMBOLS.success, c.primary);
      if (isTty) process.stdout.write('\n');
    },
    fail(next?: string) {
      if (timer) clearInterval(timer);
      if (next) text = next;
      render(SYMBOLS.failed, c.err);
      if (isTty) process.stdout.write('\n');
    },
    stop() {
      if (timer) clearInterval(timer);
      if (isTty) process.stdout.write('\r\x1b[2K');
    },
  };
}
