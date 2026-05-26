import { exec } from '../sandbox/exec.js';
import type { ValidatorFailure, ValidatorResult } from '../types.js';
import { detectProject, type ProjectInfo } from './detect.js';
import {
  parseBiome,
  parseEslint,
  parseGeneric,
  parseMypy,
  parsePytest,
  parseRuff,
  parseTsc,
  parseVitest,
} from './parse.js';

export type ValidatorSpec = {
  name: ValidatorResult['name'];
  command: string;
  /** Parser to use; defaults to a guess based on the command. */
  parser?: 'eslint' | 'biome' | 'tsc' | 'vitest' | 'pytest' | 'mypy' | 'ruff' | 'generic';
  /** Timeout per validator. */
  timeoutMs?: number;
};

export type ValidateOptions = {
  cwd: string;
  validators?: ValidatorSpec[];
  /** When true, validators run in parallel. Default: true. */
  parallel?: boolean;
  signal?: AbortSignal;
};

function guessParser(command: string): NonNullable<ValidatorSpec['parser']> {
  if (/biome/.test(command)) return 'biome';
  if (/eslint/.test(command)) return 'eslint';
  if (/tsc(\s|$)/.test(command)) return 'tsc';
  if (/vitest|jest/.test(command)) return 'vitest';
  if (/pytest/.test(command)) return 'pytest';
  if (/mypy/.test(command)) return 'mypy';
  if (/ruff/.test(command)) return 'ruff';
  return 'generic';
}

function parseFailures(
  parser: NonNullable<ValidatorSpec['parser']>,
  output: string,
  cwd: string,
): ValidatorFailure[] {
  switch (parser) {
    case 'biome':
      return parseBiome(output, cwd);
    case 'eslint':
      return parseEslint(output, cwd);
    case 'tsc':
      return parseTsc(output, cwd);
    case 'vitest':
      return parseVitest(output, cwd);
    case 'pytest':
      return parsePytest(output, cwd);
    case 'mypy':
      return parseMypy(output, cwd);
    case 'ruff':
      return parseRuff(output, cwd);
    default:
      return parseGeneric(output);
  }
}

/**
 * Default validator list when the caller doesn't pass one. Builds from
 * project type detection and skips entries the project doesn't have a
 * runner for (so a JS-only repo won't try to run pytest).
 */
export function defaultValidators(project: ProjectInfo): ValidatorSpec[] {
  const out: ValidatorSpec[] = [];
  if (project.lint) out.push({ name: 'lint', command: project.lint });
  if (project.typecheck) out.push({ name: 'typecheck', command: project.typecheck });
  if (project.test) out.push({ name: 'test', command: project.test });
  return out;
}

/**
 * Runs every validator in the given list against `cwd`, returning a
 * `ValidatorResult[]`. Each result carries structured failures suitable
 * for stitching into a `HandoffBrief`.
 */
export async function runValidators(opts: ValidateOptions): Promise<ValidatorResult[]> {
  const project = await detectProject(opts.cwd);
  const validators = opts.validators ?? defaultValidators(project);

  if (validators.length === 0) return [];

  const runOne = async (spec: ValidatorSpec): Promise<ValidatorResult> => {
    const [cmd, ...args] = spec.command.split(/\s+/);
    if (!cmd) {
      return {
        name: spec.name,
        command: spec.command,
        status: 'skip',
        failures: [],
        durationMs: 0,
      };
    }
    const res = await exec(cmd, args, {
      cwd: opts.cwd,
      timeoutMs: spec.timeoutMs ?? 180_000,
      signal: opts.signal,
    });
    const parser = spec.parser ?? guessParser(spec.command);
    const combined = `${res.stdout}\n${res.stderr}`;
    const failures =
      res.exitCode === 0 ? [] : parseFailures(parser, combined, opts.cwd);
    return {
      name: spec.name,
      command: spec.command,
      status: res.exitCode === 0 ? 'pass' : 'fail',
      failures,
      durationMs: res.durationMs,
    };
  };

  if (opts.parallel === false) {
    const out: ValidatorResult[] = [];
    for (const v of validators) out.push(await runOne(v));
    return out;
  }
  return Promise.all(validators.map(runOne));
}

/**
 * Aggregates validator results into a single pass/fail with the union
 * of structured failures. Used by handoff/tournament to decide whether
 * a run succeeded.
 */
export function summarize(results: ValidatorResult[]): {
  status: 'pass' | 'fail' | 'skip';
  failures: ValidatorFailure[];
} {
  if (results.length === 0) return { status: 'skip', failures: [] };
  const failures = results.flatMap((r) => r.failures);
  const anyFail = results.some((r) => r.status === 'fail');
  const allSkip = results.every((r) => r.status === 'skip');
  return {
    status: anyFail ? 'fail' : allSkip ? 'skip' : 'pass',
    failures,
  };
}
