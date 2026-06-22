import { startDaemon } from '../daemon/server.js';
import { BRAND_NAME } from '../branding/index.js';

/**
 * `coderouter daemon` — run the persistent app-server in the foreground.
 * Loops keep running here after any UI disconnects. The Electron app and
 * `coderouter loop` spawn this detached when no daemon is alive.
 */
export async function runDaemonCommand(opts: { cwd: string; port?: number }): Promise<void> {
  const handle = await startDaemon({ cwd: opts.cwd, port: opts.port });
  process.stdout.write(`${BRAND_NAME} daemon listening on ${handle.url}\n`);
  process.stdout.write(`  health:  ${handle.url}/api/health\n`);
  process.stdout.write(`  events:  ${handle.url}/api/loops/events (SSE)\n`);
  process.stdout.write('Press Ctrl-C to stop.\n');
  // Keep the event loop alive indefinitely.
  await new Promise<void>(() => {});
}
