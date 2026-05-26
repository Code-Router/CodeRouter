import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ProjectType = 'node' | 'python' | 'rust' | 'go' | 'unknown';

export type ProjectInfo = {
  type: ProjectType;
  /** Test runner inferred from manifest. */
  test?: string;
  /** Lint runner inferred from manifest. */
  lint?: string;
  /** Typecheck runner inferred from manifest. */
  typecheck?: string;
  /** Package manager (Node only). */
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
  manifestPath?: string;
};

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects project type by sniffing manifest files. Inferred test/lint/
 * typecheck commands come from explicit scripts when present, otherwise
 * a default for the ecosystem (vitest/pytest/cargo/go).
 */
export async function detectProject(cwd: string): Promise<ProjectInfo> {
  if (await fileExists(join(cwd, 'package.json'))) {
    const raw = await readFile(join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as {
      scripts?: Record<string, string>;
      packageManager?: string;
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    const allDeps = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
    const pm = pkg.packageManager?.split('@')[0] as ProjectInfo['packageManager'] | undefined;
    const runner = pm ?? 'npm';
    return {
      type: 'node',
      packageManager: runner,
      manifestPath: join(cwd, 'package.json'),
      test:
        scripts.test
          ? `${runner} test`
          : 'vitest' in allDeps
            ? `${runner} exec vitest run`
            : 'jest' in allDeps
              ? `${runner} exec jest`
              : undefined,
      lint:
        scripts.lint
          ? `${runner} run lint`
          : '@biomejs/biome' in allDeps
            ? `${runner} exec biome check .`
            : 'eslint' in allDeps
              ? `${runner} exec eslint .`
              : undefined,
      typecheck:
        scripts.typecheck
          ? `${runner} run typecheck`
          : 'typescript' in allDeps
            ? `${runner} exec tsc --noEmit`
            : undefined,
    };
  }

  if (
    (await fileExists(join(cwd, 'pyproject.toml'))) ||
    (await fileExists(join(cwd, 'setup.py'))) ||
    (await fileExists(join(cwd, 'requirements.txt')))
  ) {
    const manifestPath = (await fileExists(join(cwd, 'pyproject.toml')))
      ? join(cwd, 'pyproject.toml')
      : (await fileExists(join(cwd, 'setup.py')))
        ? join(cwd, 'setup.py')
        : join(cwd, 'requirements.txt');
    return {
      type: 'python',
      manifestPath,
      test: 'pytest -q',
      lint: 'ruff check .',
      typecheck: 'mypy .',
    };
  }

  if (await fileExists(join(cwd, 'Cargo.toml'))) {
    return {
      type: 'rust',
      manifestPath: join(cwd, 'Cargo.toml'),
      test: 'cargo test',
      lint: 'cargo clippy -- -D warnings',
      typecheck: 'cargo check',
    };
  }

  if (await fileExists(join(cwd, 'go.mod'))) {
    return {
      type: 'go',
      manifestPath: join(cwd, 'go.mod'),
      test: 'go test ./...',
      lint: 'go vet ./...',
      typecheck: 'go build ./...',
    };
  }

  return { type: 'unknown' };
}
