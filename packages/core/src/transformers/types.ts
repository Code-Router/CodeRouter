import type { AdapterCallInput, AdapterCallResult } from '../adapters/types.js';

/**
 * Transformer = (input, ctx) -> input | (result, ctx) -> result.
 *
 * Composable in adapter calls via `transformer: string[]`. The router or
 * provider config can pass extra hints (e.g. providerName) via ctx to let
 * a single transformer behave correctly across providers.
 */
export type TransformerContext = {
  providerName?: string;
  model?: string;
  capabilities?: import('../types.js').AdapterCapabilities;
};

export type Transformer = {
  name: string;
  /** Mutate input before the call. */
  transformIn?: (input: AdapterCallInput, ctx: TransformerContext) => AdapterCallInput;
  /** Mutate the result after the call. */
  transformOut?: (result: AdapterCallResult, ctx: TransformerContext) => AdapterCallResult;
};
