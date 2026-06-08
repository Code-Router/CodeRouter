// Namespaced re-exports for callers that want module separation.
export * as adapters from './adapters/index.js';
export * as classify from './classify/index.js';
export * as router from './router/index.js';
export * as sandbox from './sandbox/index.js';
export * as validate from './validate/index.js';
export * as modes from './modes/index.js';
export * as memory from './memory/index.js';
export * as store from './store/index.js';
export * as report from './report/index.js';
export * as config from './config/index.js';
export * as research from './research/index.js';
export * as handoff from './handoff/index.js';
export * as clarify from './clarify/index.js';
export * as context from './context/index.js';
export * as perf from './perf/index.js';
export * as transformers from './transformers/index.js';
export * as providers from './providers/index.js';
export * as workflows from './workflows/index.js';
export * as catalog from './catalog/index.js';
export * as agent from './agent/index.js';

// Convenience top-level re-exports of the most commonly used symbols.
// Mirrors what the CLI, MCP server, and eval harness import.
export * from './types.js';
export type { ProviderConfig, ProviderModelConfig } from './providers/types.js';
export type { ModeInput, ModeOutput, ModeContext } from './modes/types.js';
export type { ProgressNotifier, ProgressUpdate } from './modes/progress.js';
export type { Report } from './report/types.js';
export type { Store } from './store/index.js';
export type { Citation } from './types.js';
export type { Classification, TaskType, Effort, Mode, ProviderId, RouteRef } from './types.js';
export type {
  ActivityEvent,
  AskUserQuestionEntry,
  AskUserQuestionPayload,
} from './adapters/types.js';
export {
  ClassifierCascade,
  loadSeedCorpus,
  buildMergedIndex,
} from './classify/index.js';
export { matchInstant } from './router/instant.js';
export { pick, pickStrong } from './router/policy.js';
export { fastClassification } from './router/fast.js';
export { effortProfile } from './router/effort.js';
export { deriveMemoryBias } from './router/bias.js';
export { ProviderRegistry, defaultProviders } from './providers/index.js';
export { whichSync } from './sandbox/which.js';
export { resolveIntent, lookupModel, CATALOG } from './catalog/index.js';
export type { Intent, CatalogEntry } from './catalog/index.js';
export { runValidators, summarize, detectProject } from './validate/index.js';
export { scanContext } from './context/index.js';
export { loadProjectMemory, projectMemoryToSystemPrompt } from './memory/index.js';
export { detectClarifications } from './clarify/index.js';
export { openStore, resolveDbPath } from './store/index.js';
export { loadConfig } from './config/index.js';
export { runMode } from './modes/dispatch.js';
export {
  buildBrief,
  renderBriefAsPrompt,
  runHandoff,
} from './handoff/index.js';
export { runDualPlan } from './workflows/dualPlan.js';
export { runTournament } from './workflows/tournament.js';
export {
  buildReport,
  renderReportText,
  renderReportFooterText,
  renderReportJson,
} from './report/index.js';
export {
  DEFAULT_RULES as DEFAULT_INJECTION_RULES,
  scanText as scanForInjection,
  summarizeScan as summarizeInjectionScan,
  wrapUntrusted,
} from './security/index.js';
export type {
  InjectionFinding,
  InjectionRule,
  InjectionScanResult,
  InjectionSeverity,
} from './security/index.js';
export {
  buildCitations,
  renderReferences,
  injectInlineCitations,
  verifyCitations,
} from './research/citations.js';
