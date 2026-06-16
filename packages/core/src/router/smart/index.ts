/**
 * Smart router: adaptive OpenRouter model selection.
 *
 * Picks the best live OpenRouter model for a routing intent by scoring
 * the fetched `/models` catalog on quality, price, context, and
 * reasoning capability - so selection tracks OpenRouter's lineup instead
 * of a hardcoded shortlist.
 */

export * from './quality.js';
export * from './score.js';
export * from './select.js';
