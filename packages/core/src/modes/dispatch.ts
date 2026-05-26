import { runAgentMode } from './agent.js';
import { runDebugMode } from './debug.js';
import { runMasterplanMode } from './masterplan.js';
import { runPlanMode } from './plan.js';
import { runReviewMode } from './review.js';
import type { Mode } from '../types.js';
import type { ModeContext, ModeInput, ModeOutput } from './types.js';

/**
 * Single entrypoint shared by the CLI, the MCP server, and the eval
 * harness. Each mode is a function that consumes the same workflow
 * primitives - they differ only in stance, phase composition, and
 * output shape.
 */
export async function runMode(mode: Mode, input: ModeInput, ctx: ModeContext): Promise<ModeOutput> {
  switch (mode) {
    case 'plan':
      return runPlanMode(input, ctx);
    case 'masterplan':
      return runMasterplanMode(input, ctx);
    case 'agent':
      return runAgentMode(input, ctx);
    case 'debug':
      return runDebugMode(input, ctx);
    case 'review':
      return runReviewMode(input, ctx);
    default:
      throw new Error(`Unknown mode: ${String(mode)}`);
  }
}
