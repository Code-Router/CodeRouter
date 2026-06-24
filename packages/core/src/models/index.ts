/**
 * Quality-first model intelligence.
 *
 * A single source of truth for "what is this model and how good is it at
 * writing code", plus a selector that routes quality-first (cost only
 * breaks ties among models that already clear the bar).
 *
 *   - `cards.ts`   - curated, benchmark-grounded model catalog + aliases.
 *   - `resolve.ts` - id/alias -> normalized card (+ live OpenRouter merge,
 *                    conservative prior for unknowns).
 *   - `tiers.ts`   - quality bands + per-intent floors/objectives.
 *   - `select.ts`  - capability + floor filter, quality-first ranking.
 *   - `learn.ts`   - bounded local-outcome refinement of the priors.
 */

export * from './cards.js';
export * from './tiers.js';
export * from './resolve.js';
export * from './select.js';
export * from './learn.js';
export * from './policies.js';
