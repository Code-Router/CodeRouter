import { spawn } from 'node:child_process';
import { startDashboardServer } from '../dashboard/server.js';
import { c } from '../ui/colors.js';
import { BRAND_GLYPH } from '../branding/index.js';

export type DashboardOpts = {
  cwd: string;
  port?: number;
  open: boolean;
};

/**
 * `coderouter dashboard`
 *
 * Boots a loopback-only web UI for usage + settings and (by default)
 * opens it in the browser. Runs until interrupted (Ctrl+C).
 */
export async function runDashboardCommand(opts: DashboardOpts): Promise<void> {
  const { url, close } = await startDashboardServer({
    cwd: opts.cwd,
    port: opts.port,
  });

  process.stdout.write(
    `\n  ${c.primary(`${BRAND_GLYPH} CodeRouter dashboard`)}\n` +
      `  ${c.muted('serving usage + settings for')} ${opts.cwd}\n\n` +
      `  ${c.bold('→')} ${c.underline(url)}\n` +
      `  ${c.muted('press Ctrl+C to stop')}\n\n`,
  );

  if (opts.open) openBrowser(url);

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      process.stdout.write(c.muted('\n  shutting down dashboard…\n'));
      void close().then(resolve);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

/** Best-effort cross-platform "open this URL in the default browser". */
function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL is already printed; the user can open it manually.
  }
}
