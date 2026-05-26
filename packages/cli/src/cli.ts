import { runCli } from './app.js';

runCli(process.argv).catch((err: Error) => {
  // eslint-disable-next-line no-console
  console.error(err.stack ?? err.message);
  process.exit(1);
});
