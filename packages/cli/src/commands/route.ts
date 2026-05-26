import {
  ClassifierCascade,
  defaultProviders,
  loadSeedCorpus,
  matchInstant,
  pick,
  ProviderRegistry,
} from '@coderouter/core';
import type { Effort, ProviderConfig } from '@coderouter/core';
import { c } from '../ui/colors.js';

export type RouteCmdOpts = {
  prompt: string;
  effort?: string;
  cwd?: string;
};

export async function runRouteCommand(opts: RouteCmdOpts): Promise<void> {
  const registry = new ProviderRegistry(defaultProviders() as ProviderConfig[]);
  const instant = matchInstant(opts.prompt);
  const cascade = new ClassifierCascade({ corpus: await loadSeedCorpus() });
  const classification = instant.matched
    ? instant.classification
    : await cascade.classify({ prompt: opts.prompt, noLlm: true });
  const route = pick(classification, { registry }, { effort: (opts.effort ?? 'medium') as Effort });
  process.stdout.write(
    `${c.bold('classification')}\n  taskType=${classification.taskType}  confidence=${classification.confidence.toFixed(2)}  source=${classification.source}\n`,
  );
  process.stdout.write(`${c.bold('route')}\n  ${c.primary(`${route.via ?? route.provider},${route.model}`)}\n`);
  if (route.rationale) process.stdout.write(`  ${c.muted(route.rationale)}\n`);
}
