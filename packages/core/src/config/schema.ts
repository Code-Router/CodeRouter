import { z } from 'zod';

/** coderouter.config.{ts,js,json,mjs} -- shared schema for CLI and MCP. */

const ProviderModelSchema = z.object({
  pricePer1MIn: z.number().optional(),
  pricePer1MOut: z.number().optional(),
  contextWindow: z.number().optional(),
  transformer: z.array(z.string()).optional(),
  reasoningParam: z.string().optional(),
  extraBody: z.record(z.unknown()).optional(),
});

const ProviderSchema = z.object({
  name: z.string(),
  adapter: z.enum(['anthropic', 'openai', 'google', 'openai_compat', 'ollama', 'codex', 'claude_code']),
  baseURL: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  apiKey: z.string().optional(),
  transformer: z.array(z.string()).optional(),
  models: z.record(ProviderModelSchema),
});

const RouteOverrideSchema = z.object({
  taskType: z.enum(['feature', 'bugfix', 'refactor', 'test', 'docs', 'investigation', 'review', 'trivial']).optional(),
  route: z.string(),
});

export const ConfigSchema = z.object({
  providers: z.array(ProviderSchema).optional(),
  routes: z
    .object({
      default: z.string().optional(),
      plan: z.string().optional(),
      masterplan: z.string().optional(),
      review: z.string().optional(),
      debug: z.string().optional(),
      handoffFixer: z.string().optional(),
    })
    .optional(),
  routeOverrides: z.array(RouteOverrideSchema).optional(),
  validators: z
    .object({
      lint: z.string().optional(),
      test: z.string().optional(),
      typecheck: z.string().optional(),
    })
    .optional(),
  costCeilings: z
    .object({
      perRun: z.number().optional(),
      perDay: z.number().optional(),
    })
    .optional(),
  workflows: z
    .object({
      handoff: z.boolean().optional(),
      dualPlan: z.boolean().optional(),
      tournament: z.boolean().optional(),
      maxHandoffPasses: z.number().optional(),
      maxContenders: z.number().optional(),
    })
    .optional(),
  research: z
    .object({
      web: z.enum(['tavily', 'brave', 'off']).optional(),
      github: z.boolean().optional(),
      docs: z.boolean().optional(),
      maxHitsPerProvider: z.number().optional(),
    })
    .optional(),
  perf: z
    .object({
      preAgentColdMs: z.number().optional(),
      preAgentWarmMs: z.number().optional(),
      planModeMs: z.number().optional(),
    })
    .optional(),
  ratingPrompt: z.boolean().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
