import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { ensureDaemon } from '../daemon/lockfile.js';
import { BRAND_NAME } from '../branding/index.js';

/**
 * `coderouter app` — ensure the daemon is running, then launch the
 * Electron desktop app (CodeRouter Studio) pointed at it. Falls back to
 * printing the daemon URL when Electron isn't installed.
 */
export async function runAppCommand(opts: { cwd: string }): Promise<void> {
  const daemon = await ensureDaemon({ cwd: opts.cwd });
  process.stdout.write(`${BRAND_NAME} daemon ready at ${daemon.port ? `http://127.0.0.1:${daemon.port}` : 'unknown'}\n`);

  const require = createRequire(import.meta.url);
  let electronPath: string | null = null;
  let appDir: string | null = null;
  try {
    electronPath = require('electron') as unknown as string;
    appDir = dirname(require.resolve('@coderouter/app/package.json'));
  } catch {
    electronPath = null;
  }

  if (!electronPath || !appDir) {
    process.stdout.write(
      'Electron app is not built yet. Start it in dev with:\n' +
        '  pnpm -F @coderouter/app dev\n' +
        `It will connect to the daemon at http://127.0.0.1:${daemon.port}.\n`,
    );
    return;
  }

  const child = spawn(electronPath, [join(appDir, 'dist-electron', 'main.js')], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, CODEROUTER_DAEMON_URL: `http://127.0.0.1:${daemon.port}` },
  });
  child.unref();
  process.stdout.write('CodeRouter Studio launched.\n');
}
