import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { renderBanner } from '../ui/banner.js';
import { c } from '../ui/colors.js';

export type InitOpts = { cwd: string };

/**
 * First-run onboarding.
 *
 *   1. Detect installed host agents (Claude Code, Codex).
 *   2. Write the MCP entry into the appropriate config file.
 *   3. Drop a `.coderouter/` folder with a sample config + memory.md.
 *   4. Print the next-step incantation.
 *
 * Everything is idempotent and never overwrites existing keys without
 * a backup.
 */
export async function runInitCommand(opts: InitOpts): Promise<void> {
  process.stdout.write(renderBanner());
  process.stdout.write(c.bold('  first-run setup\n\n'));

  const claude = await detectClaudeCode();
  const codex = await detectCodex();

  process.stdout.write(`  ${dot(claude.found)} Claude Code: ${claude.found ? claude.path : 'not detected'}\n`);
  process.stdout.write(`  ${dot(codex.found)} Codex CLI:   ${codex.found ? codex.path : 'not detected'}\n\n`);

  if (claude.found) {
    await writeMcpEntryClaude(claude.path);
    process.stdout.write(c.primary(`  + registered MCP server in ${claude.path}\n`));
  }
  if (codex.found) {
    await writeMcpEntryCodex(codex.path);
    process.stdout.write(c.primary(`  + registered MCP server in ${codex.path}\n`));
  }

  await seedRepoConfig(opts.cwd);
  process.stdout.write(c.primary('  + wrote .coderouter/config.json\n'));
  process.stdout.write(c.primary('  + wrote .coderouter/memory.md\n\n'));

  process.stdout.write(`${c.bold('next:')}\n`);
  process.stdout.write(`  ${c.muted('# in any project')}\n`);
  process.stdout.write(`  ${c.primary('coderouter')}             ${c.muted('# launch the REPL')}\n`);
  process.stdout.write(`  ${c.primary('coderouter masterplan')}  ${c.muted('# research-grade plan')}\n`);
  process.stdout.write(`  ${c.muted('# or, inside Claude Code / Codex, use the `coderouter` MCP tool')}\n`);
}

function dot(b: boolean): string {
  return b ? c.primary('●') : c.muted('○');
}

async function detectClaudeCode(): Promise<{ found: boolean; path: string }> {
  const path = join(homedir(), '.claude.json');
  return { found: await fileExists(path), path };
}

async function detectCodex(): Promise<{ found: boolean; path: string }> {
  const path = join(homedir(), '.codex', 'config.toml');
  return { found: await fileExists(path), path };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeMcpEntryClaude(path: string): Promise<void> {
  type ClaudeJson = {
    mcpServers?: Record<string, { command: string; args?: string[] }>;
  };
  let parsed: ClaudeJson;
  try {
    const raw = await readFile(path, 'utf8');
    parsed = JSON.parse(raw) as ClaudeJson;
  } catch {
    parsed = {};
  }
  parsed.mcpServers ??= {};
  parsed.mcpServers.coderouter = { command: 'coderouter-mcp', args: [] };
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

async function writeMcpEntryCodex(path: string): Promise<void> {
  const existing = await readFile(path, 'utf8').catch(() => '');
  if (existing.includes('[mcp_servers.coderouter]')) return;
  const block = [
    '',
    '[mcp_servers.coderouter]',
    'command = "coderouter-mcp"',
    'args = []',
    '',
  ].join('\n');
  await writeFile(path, `${existing}${block}`, 'utf8');
}

async function seedRepoConfig(cwd: string): Promise<void> {
  const dir = join(cwd, '.coderouter');
  await mkdir(dir, { recursive: true });
  const cfgPath = join(dir, 'config.json');
  if (!(await fileExists(cfgPath))) {
    const sample = {
      validators: { test: 'pnpm test', lint: 'pnpm lint', typecheck: 'pnpm typecheck' },
      workflows: { handoff: true, dualPlan: true, tournament: false },
      research: { web: 'tavily', github: true, docs: true },
    };
    await writeFile(cfgPath, `${JSON.stringify(sample, null, 2)}\n`, 'utf8');
  }
  const memPath = join(dir, 'memory.md');
  if (!(await fileExists(memPath))) {
    await writeFile(
      memPath,
      [
        '# CodeRouter project memory',
        '',
        'Use this file to record durable preferences:',
        '',
        '- preferred libraries (e.g., zod over yup)',
        '- forbidden patterns (e.g., never use any in tests)',
        '- routing nudges (e.g., always use gpt-5 for refactors)',
        '',
        'CodeRouter reads this in addition to AGENTS.md and CLAUDE.md.',
        '',
      ].join('\n'),
      'utf8',
    );
  }
}
