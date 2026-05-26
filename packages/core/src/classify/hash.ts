import { createHash } from 'node:crypto';
import type { ClassifierInput } from './types.js';

const NORMALIZE = /\s+/g;

/**
 * Stable hash used as the classifier cache key. We normalize whitespace
 * but keep punctuation (it changes intent), and include repo head + a
 * manifest hash so the same prompt can route differently between repos
 * or after big file changes.
 */
export function classifierHash(input: ClassifierInput): string {
  const normPrompt = input.prompt.trim().replace(NORMALIZE, ' ');
  const h = createHash('sha256');
  h.update(normPrompt);
  h.update('\u0001');
  h.update(input.repoHead ?? '');
  h.update('\u0001');
  h.update(input.manifestHash ?? '');
  return h.digest('hex').slice(0, 32);
}
