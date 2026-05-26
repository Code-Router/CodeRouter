/**
 * CodeRouter MCP server entrypoint.
 * Wired in detail in the `mcp` todo.
 */

async function main(): Promise<void> {
  const { startServer } = await import('./app.js');
  await startServer();
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
