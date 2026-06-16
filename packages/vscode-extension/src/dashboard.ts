import { type ChildProcess, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { cliArgs, resolveCli } from './cli.js';

const URL_RE = /https?:\/\/(?:127\.0\.0\.1|localhost):\d+/;

/**
 * Owns the lifecycle of the local `coderouter dashboard` server process.
 *
 * Starts at most one server, parses the served URL from its stdout, and
 * tears the process down on dispose. The extension drives the CLI rather
 * than re-implementing the server, keeping this layer thin.
 */
export class DashboardServer implements vscode.Disposable {
  private proc: ChildProcess | undefined;
  private url: string | undefined;
  private starting: Promise<string> | undefined;
  private readonly output: vscode.OutputChannel;

  constructor(private readonly cwd: string) {
    this.output = vscode.window.createOutputChannel('CodeRouter Dashboard');
  }

  /** Returns the running server URL, starting it if necessary. */
  async ensure(): Promise<string> {
    if (this.url) return this.url;
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  /** Kill and restart the server, returning the new URL. */
  async restart(): Promise<string> {
    this.stop();
    return this.ensure();
  }

  private start(): Promise<string> {
    const inv = resolveCli();
    const port = vscode.workspace
      .getConfiguration('coderouter')
      .get<number>('dashboardPort', 4319);

    const args = cliArgs(inv, 'dashboard', '--no-open', '--port', String(port));
    this.output.appendLine(`$ ${inv.command} ${args.join(' ')}`);

    const child = spawn(inv.command, args, {
      cwd: this.cwd,
      env: process.env,
    });
    this.proc = child;

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Timed out waiting for the dashboard server to start.'));
        }
      }, 15_000);

      const onData = (buf: Buffer): void => {
        const text = buf.toString('utf8');
        this.output.append(text);
        const match = text.match(URL_RE);
        if (match && !settled) {
          settled = true;
          clearTimeout(timer);
          this.url = match[0];
          resolve(this.url);
        }
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', (buf: Buffer) => this.output.append(buf.toString('utf8')));

      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(
            new Error(
              `Failed to launch CodeRouter CLI (${inv.source}): ${err.message}. ` +
                `Install it with 'npm i -g coderouter' or set 'coderouter.cliPath'.`,
            ),
          );
        }
      });

      child.on('exit', (code) => {
        this.url = undefined;
        this.proc = undefined;
        this.output.appendLine(`\n[dashboard exited with code ${code ?? 'null'}]`);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Dashboard process exited early (code ${code ?? 'null'}).`));
        }
      });
    });
  }

  private stop(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = undefined;
    }
    this.url = undefined;
  }

  dispose(): void {
    this.stop();
    this.output.dispose();
  }
}
