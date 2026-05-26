import { resolve } from 'node:path';
import {
  ClassifierCascade,
  defaultProviders,
  loadSeedCorpus,
  matchInstant,
  pick,
  ProviderRegistry,
} from '@coderouter/core';
import type { Classification, Effort, ProviderConfig } from '@coderouter/core';
import { loadSuite } from './loadSuite.js';
import type { SuiteResult, TaskResult, TaskSpec } from './types.js';

/**
 * Developer-side eval harness. Runs synthetic tasks against the
 * router/classifier and asserts:
 *   - classification matches expectations (taskType, source)
 *   - the chosen route belongs to the right "family" (cheap/strong/local)
 *   - pre-agent latency budget is respected
 *
 * Mode-level tasks (plan/masterplan/agent) are stubbed in v0 - the
 * harness records expectations but does not actually call paid models
 * unless `EVAL_LIVE=1` is set.
 */
async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? process.cwd());
  const suite = await loadSuite(root);
  const filter = parseFilter();

  const corpus = await loadSeedCorpus();
  const cascade = new ClassifierCascade({ corpus });
  const registry = new ProviderRegistry(defaultProviders() as ProviderConfig[]);

  const start = performance.now();
  const taskResults: TaskResult[] = [];
  for (const task of suite.tasks) {
    if (filter && !filter.test(task.id)) continue;
    const r = await runOne(task, cascade, registry);
    taskResults.push(r);
    printResult(r);
  }
  const totals = summarize(taskResults, performance.now() - start);
  printSummary(totals);
  process.exit(totals.fail === 0 ? 0 : 1);
}

function parseFilter(): RegExp | undefined {
  const idx = process.argv.indexOf('--filter');
  const value = idx === -1 ? undefined : process.argv[idx + 1];
  if (!value) return undefined;
  return new RegExp(value);
}

async function runOne(
  task: TaskSpec,
  cascade: ClassifierCascade,
  registry: ProviderRegistry,
): Promise<TaskResult> {
  const start = performance.now();
  const reasons: string[] = [];
  let status: TaskResult['status'] = 'pass';

  const instant = matchInstant(task.prompt);
  const classification: Classification = instant.matched
    ? instant.classification
    : await cascade.classify({ prompt: task.prompt, noLlm: true });

  if (task.expect?.taskType && classification.taskType !== task.expect.taskType) {
    status = 'fail';
    reasons.push(`taskType=${classification.taskType} != expected ${task.expect.taskType}`);
  }
  if (task.expect?.source && classification.source !== task.expect.source) {
    // tolerate embed-or-rules ambiguity
    if (
      !(
        (task.expect.source === 'rules' && classification.source === 'embed') ||
        (task.expect.source === 'embed' && classification.source === 'rules')
      )
    ) {
      status = 'fail';
      reasons.push(`source=${classification.source} != expected ${task.expect.source}`);
    }
  }

  const route = pick(classification, { registry }, { effort: (task.effort ?? 'medium') as Effort });
  if (task.expect?.routeFamily) {
    const family = routeFamily(route.via ?? route.provider, route.model);
    if (family !== task.expect.routeFamily) {
      status = 'fail';
      reasons.push(`routeFamily=${family} != expected ${task.expect.routeFamily}`);
    }
  }

  const dur = performance.now() - start;
  if (task.budget?.preAgentMs && dur > task.budget.preAgentMs) {
    status = 'fail';
    reasons.push(`preAgent=${dur.toFixed(0)}ms > budget ${task.budget.preAgentMs}ms`);
  }

  // Mode tasks (plan/masterplan/agent) require live providers; mark as skip in offline mode.
  if (task.mode && task.mode !== 'review' && !process.env.EVAL_LIVE) {
    return {
      task,
      status: 'skip',
      reasons: ['mode tasks need EVAL_LIVE=1'],
      durationMs: dur,
    };
  }

  return { task, status, reasons, durationMs: dur };
}

function routeFamily(provider: string, model: string): 'cheap' | 'strong' | 'local' {
  if (provider === 'ollama') return 'local';
  const cheap = /haiku|gemini-2\.0-flash|gpt-4o-mini|mini/i;
  return cheap.test(model) ? 'cheap' : 'strong';
}

function summarize(results: TaskResult[], durationMs: number): SuiteResult {
  return {
    taskResults: results,
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    skip: results.filter((r) => r.status === 'skip').length,
    durationMs,
  };
}

function printResult(r: TaskResult): void {
  const tag =
    r.status === 'pass'
      ? '\x1b[32mPASS\x1b[0m'
      : r.status === 'fail'
        ? '\x1b[31mFAIL\x1b[0m'
        : '\x1b[33mSKIP\x1b[0m';
  process.stdout.write(`  ${tag}  ${r.task.id.padEnd(36)} ${r.durationMs.toFixed(0)}ms\n`);
  for (const reason of r.reasons) {
    process.stdout.write(`        - ${reason}\n`);
  }
}

function printSummary(s: SuiteResult): void {
  process.stdout.write('\n');
  process.stdout.write(
    `summary: ${s.pass} pass, ${s.fail} fail, ${s.skip} skip (${s.durationMs.toFixed(0)}ms)\n`,
  );
}

main().catch((err: Error) => {
  process.stderr.write(`${err.stack ?? err.message}\n`);
  process.exit(1);
});
