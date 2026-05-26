export type ClarificationSignal =
  | 'low_confidence'
  | 'multiple_task_types'
  | 'high_risk_keywords'
  | 'vague_references'
  | 'memory_conflict'
  | 'open_scope';

export type Clarification = {
  id: string;
  signal: ClarificationSignal;
  question: string;
  /** When the question is a multiple-choice, the options to present. */
  options?: string[];
  /** Default option presented to the user when they "skip". */
  defaultOption?: string;
  /** Free-form context that explains why this question is being asked. */
  context: string;
};
