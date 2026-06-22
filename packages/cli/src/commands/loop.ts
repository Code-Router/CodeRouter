import {
  applyPreset,
  generateLoopSpec,
  runLoop,
  validateLoopSpec,
  type LoopPreset,
  type LoopSpec,
  type VerifierResult,
} from '@coderouter/core';
import { buildExecutionEnv } from '../runtime.js';

/**
 * `coderouter loop "<goal>"` — the AI Loop Builder + Runner in the
 * terminal. Discovers verifier commands, generates a bounded LoopSpec,
 * validates it, and (with --run) executes the deterministic
 * verify -> plan -> edit -> review -> rerun loop, streaming progress.
 *
 * This is the headless MVP vertical ("fix failing tests"): describe the
 * outcome, CodeRouter builds + runs the loop.
 */

export type LoopCommandOpts = {
  request: string;
  cwd: string;
  preset?: string;
  run?: boolean;
  apply?: boolean;
  maxIterations?: number;
  json?: boolean;
};

const VALID_PRESETS = new Set<LoopPreset>(['safe', 'aggressive', 'ci-repair', 'migration']);

export async function runLoopCommand(opts: LoopCommandOpts): Promise<void> {
  if (!opts.request.trim()) {
    process.stderr.write('Usage: coderouter loop "<what you want done>" [--run] [--apply] [--preset safe]\n');
    process.exitCode = 1;
    return;
  }

  const preset: LoopPreset =
    opts.preset && VALID_PRESETS.has(opts.preset as LoopPreset) ? (opts.preset as LoopPreset) : 'safe';

  const { registry, router } = await buildExecutionEnv(opts.cwd);
  process.stdout.write('Generating loop spec...\n');
  const { spec: generated, discovered, generated: usedModel } = await generateLoopSpec(
    opts.request,
    { registry, router, cwd: opts.cwd },
    { preset },
  );

  let spec: LoopSpec = generated;
  if (opts.maxIterations && Number.isFinite(opts.maxIterations)) {
    spec = { ...spec, limits: { ...spec.limits, maxIterations: opts.maxIterations } };
  }
  if (opts.apply) {
    spec = applyPreset({ ...spec, safety: { ...spec.safety, requireApprovalBeforeCommit: false } }, preset);
    spec.safety.requireApprovalBeforeCommit = false;
  }

  const validation = validateLoopSpec(spec);

  if (opts.json && !opts.run) {
    process.stdout.write(`${JSON.stringify({ spec, discovered, validation, generated: usedModel }, null, 2)}\n`);
    return;
  }

  printSpec(spec, validation.warnings);
  if (discovered.commands.length === 0) {
    process.stdout.write('\n⚠ No verifier commands were detected in this repo.\n');
  }
  if (!validation.valid) {
    process.stdout.write(`\n✗ Loop is not runnable:\n${validation.issues.map((i) => `  - ${i}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }

  if (!opts.run) {
    process.stdout.write('\nSpec looks valid. Re-run with --run to execute (add --apply to merge without approval).\n');
    return;
  }

  process.stdout.write('\nRunning loop...\n');
  const result = await runLoop(spec, { registry, router, cwd: opts.cwd }, {
    loopId: `cli-${Date.now()}`,
    callbacks: {
      onPhase: (i, phase, message) => process.stdout.write(`  [iter ${i}] ${phase}: ${message}\n`),
      onVerifier: (i, r: VerifierResult) =>
        process.stdout.write(`  [iter ${i}] $ ${r.command} -> ${r.ok ? 'pass' : `FAIL (exit ${r.exitCode})`}\n`),
    },
  });

  process.stdout.write('\n');
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printResult(result);
  }
  if (result.status === 'failed') process.exitCode = 1;
}

function printSpec(spec: LoopSpec, warnings: string[]): void {
  const lines = [
    `\nLoop: ${spec.name}`,
    `Goal: ${spec.goal}`,
    `Preset: ${spec.preset ?? 'safe'}`,
    'Verifier:',
    ...(spec.verifier.commands.length ? spec.verifier.commands.map((c) => `  - ${c}`) : ['  (none)']),
    `Limits: ${spec.limits.maxIterations} iters · $${spec.limits.maxCostUsd} · ${spec.limits.maxFilesChanged} files`,
    `Safety: approval=${spec.safety.requireApprovalBeforeCommit} · network=${spec.safety.allowNetwork} · blocked=${spec.safety.blockedFiles.length}`,
    `Models: planner=${spec.models.planner} executor=${spec.models.executor} reviewer=${spec.models.reviewer} summarizer=${spec.models.summarizer}`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  if (warnings.length) process.stdout.write(`\nNotes:\n${warnings.map((w) => `  • ${w}`).join('\n')}\n`);
}

function printResult(result: Awaited<ReturnType<typeof runLoop>>): void {
  const icon = result.status === 'succeeded' ? '✓' : result.status === 'awaiting_approval' ? '⏸' : '✗';
  process.stdout.write(`${icon} ${result.status.toUpperCase()} — ${result.reason}\n`);
  process.stdout.write(`  iterations: ${result.iterations.length}\n`);
  process.stdout.write(`  cost:       $${result.costUsd.toFixed(4)}\n`);
  process.stdout.write(`  files:      ${result.filesChanged.length}${result.filesChanged.length ? ` (${result.filesChanged.join(', ')})` : ''}\n`);
  if (result.status === 'awaiting_approval') {
    process.stdout.write('  changes are staged in an isolated worktree and await approval (use the app, or --apply to auto-merge).\n');
  }
  if (result.applied) process.stdout.write('  merged into the working tree.\n');
}
