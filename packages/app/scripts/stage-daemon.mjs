/**
 * Stage the CodeRouter daemon into `resources/cli` so electron-builder can
 * ship it inside the packaged app. This makes CodeRouter Studio fully
 * self-contained: it spawns `<resources>/cli/dist/cli.js daemon` under
 * Electron's bundled Node (which includes node:sqlite), so the app works on
 * a machine with no global Node or `coderouter` install.
 *
 * The bundled cli.js (built by tsup) keeps a handful of dependencies external
 * and imports them statically, so they must exist in an adjacent
 * node_modules:
 *   - ink + react: the REPL renderer. Never rendered by the daemon, but ESM
 *     resolves the static imports at load, so they must be present.
 *   - ws: WebSocket server for the terminal PTY relay.
 *   - @vscode/ripgrep: per-platform `rg` binary for fast context scanning.
 *   - node-pty: native terminal backend (NAPI prebuilds).
 *
 * Pure-JS deps (ink/react/ws/ripgrep) are materialised with a real `npm
 * install` so their full transitive closure is correct and flat. node-pty is
 * copied from the workspace instead — it already carries working NAPI
 * prebuilds, and reinstalling it risks a native recompile.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(appDir, '..', '..');
const cliDir = join(repoRoot, 'packages', 'cli');
const out = join(appDir, 'resources', 'cli');

const cliJs = join(cliDir, 'dist', 'cli.js');
if (!existsSync(cliJs)) {
  console.error('[stage-daemon] packages/cli/dist/cli.js not found — build the CLI first (pnpm --filter coderouter-cli build).');
  process.exit(1);
}

// Pin to the versions declared by the CLI so the bundle matches what we test.
const cliPkg = JSON.parse(
  (await import('node:fs')).readFileSync(join(cliDir, 'package.json'), 'utf8'),
);
const want = (name) => cliPkg.dependencies?.[name] ?? cliPkg.devDependencies?.[name] ?? 'latest';

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'dist'), { recursive: true });
cpSync(cliJs, join(out, 'dist', 'cli.js'));

// 1. package.json with the pure-JS externals; `npm install` resolves the
//    full (flat) transitive closure, including ripgrep's per-platform binary
//    package (an optionalDependency).
writeFileSync(
  join(out, 'package.json'),
  `${JSON.stringify(
    {
      name: 'coderouter-daemon',
      private: true,
      type: 'module',
      dependencies: {
        '@vscode/ripgrep': want('@vscode/ripgrep'),
        ink: want('ink'),
        react: want('react'),
        ws: want('ws'),
      },
    },
    null,
    2,
  )}\n`,
);

console.log('[stage-daemon] installing daemon runtime deps (ink, react, ws, ripgrep)…');
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], {
  cwd: out,
  stdio: 'inherit',
});

// 2. node-pty: copy the already-built package (with NAPI prebuilds) from the
//    workspace to avoid a native recompile during install.
const ptySrc = [join(cliDir, 'node_modules', 'node-pty'), join(repoRoot, 'node_modules', 'node-pty')].find(existsSync);
if (ptySrc) {
  cpSync(realpathSync(ptySrc), join(out, 'node_modules', 'node-pty'), { recursive: true, dereference: true });
  console.log('[stage-daemon] staged node-pty (terminal backend)');
} else {
  console.warn('[stage-daemon] node-pty not found in workspace — terminal will be unavailable');
}

console.log(`[stage-daemon] daemon staged at ${out}`);
