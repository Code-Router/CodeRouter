import type { AdapterCapabilities, ProviderId } from '../types.js';
import type { Adapter, AdapterCallInput, AdapterCallResult } from './types.js';

export abstract class BaseAdapter implements Adapter {
  abstract id: ProviderId;
  abstract name: string;
  abstract capabilities: AdapterCapabilities;

  abstract run(input: AdapterCallInput): Promise<AdapterCallResult>;

  /** Default `plan` implementation delegates to `run` with a planner-shaped prompt. */
  async plan(input: AdapterCallInput): Promise<AdapterCallResult> {
    const planPrompt = [
      'You are producing a focused implementation plan. Do not write code.',
      'Output a numbered list of concrete steps with file paths where applicable.',
      'Surface uncertainty as explicit "OPEN QUESTION:" lines.',
      '',
      input.prompt,
    ].join('\n');
    return this.run({ ...input, prompt: planPrompt });
  }

  /** Optional scoring hook (used by judge models). Default = neutral. */
  async score(_input: AdapterCallInput): Promise<number> {
    return 0;
  }

  /** USD cost from token counts using the adapter's per-1M pricing. */
  estimateCost(tokensIn: number, tokensOut: number): number {
    const c = this.capabilities;
    return (tokensIn / 1_000_000) * c.pricePer1MIn + (tokensOut / 1_000_000) * c.pricePer1MOut;
  }
}
