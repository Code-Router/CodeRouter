import { spawn } from 'node:child_process';
import { createServer } from 'vite';

/**
 * Dev launcher: start the Vite renderer dev server, then launch Electron
 * pointed at it. Kills Electron when Vite stops and vice-versa.
 */
const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const info = server.config.server;
const port = server.httpServer?.address()?.port ?? info.port ?? 5273;
const url = `http://localhost:${port}`;
server.printUrls();

// Build the electron main/preload once before launching.
await new Promise((resolve, reject) => {
  const b = spawn('npm', ['run', 'build:main'], { stdio: 'inherit' });
  b.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('build:main failed'))));
});

const electron = (await import('electron')).default;
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

child.on('exit', () => {
  void server.close().then(() => process.exit(0));
});
