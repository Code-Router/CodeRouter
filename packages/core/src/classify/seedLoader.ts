import type { SeedExample } from './types.js';
import seed from './seed-corpus.json' with { type: 'json' };

type CorpusFile = { version?: number; examples?: SeedExample[] };

/**
 * Loads the bundled seed corpus. We import the JSON directly with the
 * `with { type: 'json' }` assertion so it's bundled by tsup and shipped
 * as a single file in dist.
 */
export async function loadSeedCorpus(): Promise<SeedExample[]> {
  const file = seed as CorpusFile;
  return file.examples ?? [];
}
