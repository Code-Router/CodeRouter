import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Verifier discovery.
 *
 * Before generating a loop, CodeRouter inspects the repo to find the
 * objective verification commands the loop will gate on. Users often
 * don't know the exact command, so detecting them from project manifests
 * makes loop creation far more reliable.
 */

export type VerifierKind = 'test' | 'lint' | 'typecheck' | 'build';

export type DiscoveredCommand = {
  kind: VerifierKind;
  command: string;
  /** Where it came from, for the UI ("package.json script: test"). */
  source: string;
};

export type DiscoveredVerifiers = {
  ecosystem: 'node' | 'python' | 'rust' | 'go' | 'unknown';
  packageManager: string | null;
  commands: DiscoveredCommand[];
};

async function readJsonFile<T = Record<string, unknown>>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Detect the JS package manager from lockfiles. */
async function detectNodePm(cwd: string): Promise<string> {
  if (await exists(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(join(cwd, 'yarn.lock'))) return 'yarn';
  if (await exists(join(cwd, 'bun.lockb'))) return 'bun';
  return 'npm';
}

const NODE_SCRIPT_MATCHERS: Array<{ kind: VerifierKind; names: string[] }> = [
  { kind: 'test', names: ['test', 'test:unit', 'tests', 'vitest', 'jest'] },
  { kind: 'lint', names: ['lint', 'eslint', 'biome:check', 'check'] },
  { kind: 'typecheck', names: ['typecheck', 'type-check', 'tsc', 'types'] },
  { kind: 'build', names: ['build'] },
];

function runScript(pm: string, script: string): string {
  // `npm run X` / `pnpm X` / `yarn X` / `bun run X`. `test` is special-cased
  // by npm/yarn (no `run` needed) but `run` works everywhere.
  if (pm === 'pnpm' || pm === 'yarn') return `${pm} ${script}`;
  if (pm === 'bun') return `bun run ${script}`;
  return `npm run ${script}`;
}

/**
 * Scan a repo for test/lint/typecheck/build commands. Returns an empty
 * command list (not an error) when nothing is recognized, so the caller
 * can prompt the user to supply one.
 */
export async function discoverVerifiers(cwd: string): Promise<DiscoveredVerifiers> {
  // Node / JS
  const pkg = await readJsonFile<{ scripts?: Record<string, string> }>(join(cwd, 'package.json'));
  if (pkg) {
    const pm = await detectNodePm(cwd);
    const scripts = pkg.scripts ?? {};
    const commands: DiscoveredCommand[] = [];
    const seen = new Set<VerifierKind>();
    for (const matcher of NODE_SCRIPT_MATCHERS) {
      for (const name of matcher.names) {
        if (scripts[name] && !seen.has(matcher.kind)) {
          commands.push({ kind: matcher.kind, command: runScript(pm, name), source: `package.json script: ${name}` });
          seen.add(matcher.kind);
          break;
        }
      }
    }
    return { ecosystem: 'node', packageManager: pm, commands };
  }

  // Python
  const pyproject = await readTextFile(join(cwd, 'pyproject.toml'));
  const hasSetup = await exists(join(cwd, 'setup.py'));
  const hasReqs = await exists(join(cwd, 'requirements.txt'));
  if (pyproject || hasSetup || hasReqs) {
    const commands: DiscoveredCommand[] = [];
    const text = pyproject ?? '';
    if (text.includes('pytest') || (await exists(join(cwd, 'tests')))) {
      commands.push({ kind: 'test', command: 'pytest', source: 'pytest' });
    }
    if (text.includes('ruff')) commands.push({ kind: 'lint', command: 'ruff check .', source: 'ruff' });
    if (text.includes('mypy')) commands.push({ kind: 'typecheck', command: 'mypy .', source: 'mypy' });
    return { ecosystem: 'python', packageManager: pyproject ? 'uv/pip' : 'pip', commands };
  }

  // Rust
  if (await exists(join(cwd, 'Cargo.toml'))) {
    return {
      ecosystem: 'rust',
      packageManager: 'cargo',
      commands: [
        { kind: 'test', command: 'cargo test', source: 'Cargo.toml' },
        { kind: 'lint', command: 'cargo clippy -- -D warnings', source: 'clippy' },
        { kind: 'build', command: 'cargo build', source: 'Cargo.toml' },
      ],
    };
  }

  // Go
  if (await exists(join(cwd, 'go.mod'))) {
    return {
      ecosystem: 'go',
      packageManager: 'go',
      commands: [
        { kind: 'test', command: 'go test ./...', source: 'go.mod' },
        { kind: 'build', command: 'go build ./...', source: 'go.mod' },
        { kind: 'lint', command: 'go vet ./...', source: 'go vet' },
      ],
    };
  }

  return { ecosystem: 'unknown', packageManager: null, commands: [] };
}
