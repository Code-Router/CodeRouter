import type { CognitiveShape, TaskType } from '../types.js';

export type ClassifierInput = {
  prompt: string;
  /** Optional repo head sha used as part of the cache key. */
  repoHead?: string;
  /** Optional context manifest hash used as part of the cache key. */
  manifestHash?: string;
  /** Optional cwd used for repo-aware features. */
  cwd?: string;
  /** When true, skip stage 3 (LLM judge). */
  noLlm?: boolean;
};

export type SeedExample = {
  id: string;
  prompt: string;
  taskType: TaskType;
  shape: CognitiveShape;
  notes?: string;
  tags?: string[];
};

export type ClassifierStageResult = {
  stage: 'rules' | 'embed' | 'llm' | 'cache' | 'instant';
  confidence: number;
  taskType: TaskType;
  shape: CognitiveShape;
  rationale: string;
};
