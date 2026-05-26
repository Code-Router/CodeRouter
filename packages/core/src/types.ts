/**
 * Cross-module shared types for CodeRouter.
 *
 * Modules export their own types from their respective barrels; this file
 * holds the small set that crosses module boundaries (used by router,
 * adapters, modes, classifier, store, etc.).
 */

export type Effort = 'low' | 'medium' | 'high' | 'max';

export type Mode = 'plan' | 'masterplan' | 'agent' | 'debug' | 'review';

export type TaskType =
  | 'feature'
  | 'bugfix'
  | 'refactor'
  | 'test'
  | 'docs'
  | 'investigation'
  | 'review'
  | 'trivial';

export type CognitiveShape = {
  deepReasoning: number;
  multiFileTaste: number;
  hugeContext: number;
  adversarial: number;
  algorithmic: number;
  exploratory: number;
};

export type Classification = {
  taskType: TaskType;
  shape: CognitiveShape;
  confidence: number;
  rationale: string;
  source: 'rules' | 'embed' | 'llm' | 'cache' | 'instant';
  hash: string;
};

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openai_compat'
  | 'ollama'
  | 'codex'
  | 'claude_code';

export type AdapterCapabilities = {
  canEdit: boolean;
  canPlan: boolean;
  longContext: boolean;
  reasoning: boolean;
  tools: boolean;
  streaming: boolean;
  vision: boolean;
  pricePer1MIn: number;
  pricePer1MOut: number;
  contextWindow: number;
  family: 'shell-agent' | 'api-model';
};

export type RouteRef = {
  provider: ProviderId;
  model: string;
  rationale: string;
  via?: string;
};

export type RunBudget = {
  maxCostUsd: number;
  maxDurationMs: number;
  maxHandoffPasses: number;
  maxContenders: number;
};

export type RunOutcome = {
  runId: string;
  status: 'success' | 'partial' | 'failed' | 'aborted';
  diff?: string;
  filesChanged: string[];
  validators: ValidatorResult[];
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  routes: RouteRef[];
  rationale: string;
  effectiveness?: number;
};

export type ValidatorResult = {
  name: 'lint' | 'typecheck' | 'test' | 'custom';
  command: string;
  status: 'pass' | 'fail' | 'skip';
  failures: ValidatorFailure[];
  durationMs: number;
};

export type ValidatorFailure = {
  file?: string;
  line?: number;
  column?: number;
  rule?: string;
  message: string;
  severity: 'error' | 'warning';
};

export type Citation = {
  id: number;
  kind: 'web' | 'github' | 'docs' | 'memory' | 'local';
  url?: string;
  title: string;
  source: string;
  snippet?: string;
  verified?: boolean;
  fetchedAt: string;
};

export type ContextManifestEntry = {
  path: string;
  reason: string;
  importance: number;
  tokenEstimate: number;
};

export type ContextManifest = {
  entries: ContextManifestEntry[];
  totalTokens: number;
  budget: number;
  truncated: boolean;
};

export type Logger = {
  debug: (msg: string, meta?: unknown) => void;
  info: (msg: string, meta?: unknown) => void;
  warn: (msg: string, meta?: unknown) => void;
  error: (msg: string, meta?: unknown) => void;
};
