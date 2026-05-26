/**
 * CodeRouter CLI entrypoint.
 * Wired in detail in the `cli` todo.
 */

async function main(): Promise<void> {
  const { runCli } = await import('./app.js');
  await runCli(process.argv);
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
