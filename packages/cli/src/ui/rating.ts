import { c } from './colors.js';

/**
 * Single-keystroke thumbs up/down prompt. Used after `agent` runs to
 * gather the lightweight binary signal that feeds L5 routing bias.
 *
 * Returns 1 / -1 / 0 (skipped). Times out after 6 seconds to never
 * block a CLI that's piped to another tool.
 */
export async function askForRating(): Promise<-1 | 0 | 1> {
  if (!process.stdin.isTTY) return 0;
  process.stdout.write(c.muted('  rate this run: [y]es / [n]o / [s]kip  '));

  const stdin = process.stdin;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    const onData = (chunk: string) => {
      const k = chunk.toLowerCase();
      cleanup();
      if (k === 'y') {
        process.stdout.write(c.primary('thanks!\n'));
        resolve(1);
        return;
      }
      if (k === 'n') {
        process.stdout.write(c.muted('logged.\n'));
        resolve(-1);
        return;
      }
      process.stdout.write(c.muted('skipped.\n'));
      resolve(0);
    };
    const timer = setTimeout(() => {
      cleanup();
      process.stdout.write(c.muted('(skip)\n'));
      resolve(0);
    }, 6_000);

    function cleanup() {
      stdin.setRawMode?.(false);
      stdin.removeListener('data', onData);
      stdin.pause();
      clearTimeout(timer);
    }

    stdin.on('data', onData);
  });
}
