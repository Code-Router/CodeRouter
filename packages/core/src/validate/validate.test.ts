import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectProject } from './detect.js';
import { parseEslint, parseMypy, parsePytest, parseRuff, parseTsc, parseVitest } from './parse.js';
import { runValidators, summarize } from './run.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cr-val-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('detectProject', () => {
  it('detects a Node project with vitest', async () => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 't',
        devDependencies: { vitest: '^2', typescript: '^5' },
      }),
    );
    const p = await detectProject(dir);
    expect(p.type).toBe('node');
    expect(p.test).toMatch(/vitest/);
    expect(p.typecheck).toMatch(/tsc/);
  });

  it('detects a Python project from pyproject.toml', async () => {
    await writeFile(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n');
    const p = await detectProject(dir);
    expect(p.type).toBe('python');
    expect(p.test).toBe('pytest -q');
  });

  it('falls back to unknown', async () => {
    const p = await detectProject(dir);
    expect(p.type).toBe('unknown');
  });
});

describe('parsers', () => {
  it('parses tsc errors', () => {
    const out = parseTsc(
      `src/foo.ts(12,34): error TS2322: Type 'string' is not assignable to type 'number'.\nrandom line`,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      file: 'src/foo.ts',
      line: 12,
      column: 34,
      rule: 'TS2322',
      severity: 'error',
    });
  });

  it('parses eslint errors', () => {
    const text =
      './src/foo.ts\n  12:34  error  Unexpected token  no-undef\n  15:1   warning  Missing trailing comma  comma-dangle\n';
    const out = parseEslint(text);
    expect(out).toHaveLength(2);
    expect(out[0]?.severity).toBe('error');
    expect(out[1]?.severity).toBe('warning');
  });

  it('parses vitest fail lines', () => {
    const text = ' FAIL  src/foo.test.ts > expected greeting\nstack trace ...';
    const out = parseVitest(text);
    expect(out).toHaveLength(1);
    expect(out[0]?.file).toBe('src/foo.test.ts');
  });

  it('parses pytest FAILED lines', () => {
    const out = parsePytest(
      'FAILED tests/test_foo.py::test_bar - AssertionError: nope\nOther output',
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('test_bar');
  });

  it('parses ruff and mypy lines', () => {
    const ruff = parseRuff('src/foo.py:12:34: E501 line too long\n');
    expect(ruff[0]?.rule).toBe('E501');
    const mypy = parseMypy('src/foo.py:12: error: incompatible types\n');
    expect(mypy[0]?.message).toContain('incompatible');
  });
});

describe('runValidators', () => {
  it('runs a passing custom validator and returns pass', async () => {
    const out = await runValidators({
      cwd: dir,
      validators: [{ name: 'custom', command: 'true' }],
    });
    expect(out[0]?.status).toBe('pass');
    expect(summarize(out).status).toBe('pass');
  });

  it('runs a failing validator and returns fail with structured output', async () => {
    const out = await runValidators({
      cwd: dir,
      validators: [{ name: 'custom', command: 'false' }],
    });
    expect(out[0]?.status).toBe('fail');
  });

  it('skips when validators is empty', async () => {
    const out = await runValidators({ cwd: dir, validators: [] });
    expect(out).toEqual([]);
    expect(summarize(out).status).toBe('skip');
  });
});
