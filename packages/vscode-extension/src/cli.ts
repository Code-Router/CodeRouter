import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

export type CliInvocation = {
  /** Executable to spawn (e.g. `coderouter` or `node`). */
  command: string;
  /** Leading args before any subcommand (e.g. `[<path>/cli.js]` when using node). */
  prefixArgs: string[];
  /** A human-readable description of how the CLI was resolved. */
  source: string;
};

/**
 * Resolve how to invoke the CodeRouter CLI.
 *
 * Order:
 *  1. The `coderouter.cliPath` setting (a command on PATH or absolute path).
 *  2. The repo-local build (`packages/cli/dist/cli.js`) when the user is
 *     running the extension from inside the CodeRouter monorepo / a dev
 *     checkout — invoked via `node`.
 *
 * The returned invocation is `command` + `prefixArgs`; callers append the
 * subcommand + flags.
 */
export function resolveCli(): CliInvocation {
  const configured = vscode.workspace
    .getConfiguration('coderouter')
    .get<string>('cliPath', 'coderouter')
    .trim();

  // If the configured value points at a real cli.js, run it through node.
  if (configured.endsWith('.js') && existsSync(configured)) {
    return { command: 'node', prefixArgs: [configured], source: `node ${configured}` };
  }

  // Otherwise treat it as a binary name / path resolved against PATH.
  if (configured && configured !== 'coderouter') {
    return { command: configured, prefixArgs: [], source: configured };
  }

  // Dev fallback: a built CLI inside the open workspace (monorepo checkout).
  const local = findLocalCliJs();
  if (local) {
    return { command: 'node', prefixArgs: [local], source: `node ${local} (workspace build)` };
  }

  // Default: rely on a globally installed `coderouter`.
  return { command: 'coderouter', prefixArgs: [], source: 'coderouter (PATH)' };
}

/** Build the full argv (command-line string parts) for a subcommand. */
export function cliArgs(inv: CliInvocation, ...args: string[]): string[] {
  return [...inv.prefixArgs, ...args];
}

/** Quote-safe single command string for sending to an integrated terminal. */
export function cliShellCommand(inv: CliInvocation, ...args: string[]): string {
  return [inv.command, ...cliArgs(inv, ...args)].map(quoteArg).join(' ');
}

function quoteArg(arg: string): string {
  if (/^[A-Za-z0-9_\-./]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function findLocalCliJs(): string | undefined {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const candidate = join(folder.uri.fsPath, 'packages', 'cli', 'dist', 'cli.js');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
