import type { Effort, Mode, TaskType } from '@coderouter/core';

export type ExpectedShape = Partial<{
  deepReasoning: boolean;
  longContext: boolean;
  multiFileTaste: boolean;
  bigToken: boolean;
}>;

export type TaskExpect = {
  taskType?: TaskType;
  source?: 'instant' | 'rules' | 'embed' | 'llm' | 'fallback';
  routeFamily?: 'cheap' | 'strong' | 'local';
  cognitiveShape?: ExpectedShape;
  planContains?: string[];
  citationCount?: string;
  validatorStatus?: 'pass' | 'fail';
  handoffAttempted?: boolean;
};

export type TaskBudget = Partial<{
  preAgentMs: number;
  planModeMs: number;
}>;

export type TaskSpec = {
  id: string;
  description?: string;
  prompt: string;
  mode?: Mode;
  effort?: Effort;
  fixture?: string;
  expect?: TaskExpect;
  budget?: TaskBudget;
};

export type BaselineSpec = {
  name: string;
  route?: string;
  via?: string;
};

export type EvalSuite = {
  tasks: TaskSpec[];
  baselines: BaselineSpec[];
};

export type TaskResult = {
  task: TaskSpec;
  status: 'pass' | 'fail' | 'skip';
  reasons: string[];
  durationMs: number;
};

export type SuiteResult = {
  taskResults: TaskResult[];
  pass: number;
  fail: number;
  skip: number;
  durationMs: number;
};
