import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

/**
 * CodeRouter MCP server.
 *
 * Exposes:
 *   Mode-level tools:  plan / masterplan / agent_run / debug / review
 *   Workflow tools:    route / delegate / validate / plan_dual / score
 *   Memory tools:      memory_show / memory_forget / memory_export
 *   Research tools:    research_web / research_github / research_docs / fetch_source
 *   Plan-file tools:   plan_execute / clarify
 *
 * Transport: stdio (default), matches both Claude Code (`.mcp.json`)
 * and Codex CLI (`~/.codex/config.toml`).
 */
export async function startServer(): Promise<void> {
  const server = new McpServer(
    {
      name: 'coderouter',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // eslint-disable-next-line no-console
  console.error('[coderouter mcp] listening on stdio');
}
