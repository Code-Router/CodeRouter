import {
  ClassifierCascade,
  defaultProviders,
  estimateDifficulty,
  explainIntent,
  loadSeedCorpus,
  matchInstant,
  pick,
  ProviderRegistry,
  routingPolicy,
} from '@coderouter/core';
import type { Effort, ProviderConfig, Selection } from '@coderouter/core';
import { c } from '../ui/colors.js';

export type RouteCmdOpts = {
  prompt: string;
  effort?: string;
  cwd?: string;
  explain?: boolean;
};

export async function runRouteCommand(opts: RouteCmdOpts): Promise<void> {
  const registry = new ProviderRegistry(defaultProviders() as ProviderConfig[]);
  const effort = (opts.effort ?? 'medium') as Effort;
  const instant = matchInstant(opts.prompt);
  const cascade = new ClassifierCascade({ corpus: await loadSeedCorpus() });
  const classification = instant.matched
    ? instant.classification
    : await cascade.classify({ prompt: opts.prompt, noLlm: true });
  const route = pick(classification, { registry }, { effort, prompt: opts.prompt });

  process.stdout.write(
    `${c.bold('classification')}\n  taskType=${classification.taskType}  confidence=${classification.confidence.toFixed(2)}  source=${classification.source}\n`,
  );
  process.stdout.write(`${c.bold('route')}\n  ${c.primary(`${route.via ?? route.provider},${route.model}`)}\n`);
  if (route.rationale) process.stdout.write(`  ${c.muted(route.rationale)}\n`);

  if (!opts.explain) return;

  const difficulty = estimateDifficulty(classification, effort, opts.prompt);
  const policy = routingPolicy(classification, effort, difficulty);

  process.stdout.write(`\n${c.bold('difficulty')}\n`);
  process.stdout.write(
    `  score=${difficulty.score.toFixed(2)}  band=${difficulty.band}\n  ${c.muted(difficulty.factors.join('  '))}\n`,
  );

  process.stdout.write(`\n${c.bold('shape')}\n`);
  const s = classification.shape;
  process.stdout.write(
    `  ${c.muted(
      `deepReasoning=${s.deepReasoning.toFixed(2)} multiFile=${s.multiFileTaste.toFixed(2)} hugeContext=${s.hugeContext.toFixed(2)} adversarial=${s.adversarial.toFixed(2)} algorithmic=${s.algorithmic.toFixed(2)}`,
    )}\n`,
  );

  process.stdout.write(`\n${c.bold('policy')}\n`);
  const w = policy.weights;
  process.stdout.write(
    `  ${policy.name}  intent=${policy.intent}  floor=${policy.floor}  objective=${policy.objective}\n` +
      `  weights: quality=${w.quality} cheapness=${w.cheapness} speed=${w.speed} context=${w.context} reasoning=${w.reasoning}\n` +
      `  ${c.muted(policy.rationale)}\n`,
  );

  const ranked = explainIntent(policy.intent, registry, {
    floor: policy.floor,
    objective: policy.objective,
    weights: policy.weights,
  });

  process.stdout.write(`\n${c.bold('candidates (value-ranked)')}\n`);
  if (ranked.length === 0) {
    process.stdout.write(`  ${c.muted('(no ready providers for this intent)')}\n`);
    return;
  }
  for (const [i, sel] of ranked.slice(0, 6).entries()) {
    process.stdout.write(`  ${i === 0 ? c.primary(formatSelection(sel)) : formatSelection(sel)}\n`);
  }
}

function formatSelection(sel: Selection): string {
  const price = (Math.max(0, sel.candidate.pricePer1MIn) + Math.max(0, sel.candidate.pricePer1MOut)).toFixed(2);
  const tag = `${sel.candidate.via ?? sel.candidate.adapter},${sel.candidate.model}`;
  return `${tag.padEnd(42)} ${sel.tier.padEnd(8)} coding=${String(Math.round(sel.quality)).padStart(3)}  $${price}/1M  ${c.muted(sel.rationale)}`;
}
