import type { Classification } from '../types.js';
import type { Clarification, ClarificationSignal } from './types.js';

export type DetectorInput = {
  prompt: string;
  classification?: Classification;
  /** Files the user has already selected as in-scope; if empty, scope is unclear. */
  selectedFiles?: string[];
  /** Memory facts that conflict with the prompt (e.g. user said yarn, project uses pnpm). */
  memoryConflicts?: { fact: string; conflictsWith: string }[];
};

const HIGH_RISK_PATTERNS: RegExp[] = [
  /\bdrop\s+(table|database|schema)\b/i,
  /\bdelete\s+(all|every|the entire)\b/i,
  /\bDELETE\s+FROM\b/i,
  /\brebase\s+(main|master|production)\b/i,
  /\bforce[-\s]?push\b/i,
  /\bsudo\b/i,
  /\brm\s+-rf\b/i,
];

const VAGUE_REFERENCE_PATTERNS: RegExp[] = [
  /\b(this|that|those|these)\s+(?:file|function|method|component)\b/i,
  /\b(?:the )?usual (?:way|thing|approach)\b/i,
  /\bfix\s+it\b/i,
  /\bsomewhere\b/i,
];

const OPEN_SCOPE_PATTERNS: RegExp[] = [
  /\b(everything|all\s+files?|the\s+whole\s+(?:repo|codebase|project))\b/i,
  /\bfeature\s+complete\b/i,
  /\bproduction[-\s]ready\b/i,
];

/**
 * Detects up to 2 most-pressing clarifications from the six signals.
 * Order of signals (high priority first):
 *   1) high_risk_keywords
 *   2) memory_conflict
 *   3) open_scope
 *   4) multiple_task_types
 *   5) low_confidence
 *   6) vague_references
 *
 * The cap of 2 per round keeps the clarify-then-act loop from drifting
 * into 20-questions, which is the failure mode users hate in agentic
 * workflows.
 */
export function detectClarifications(input: DetectorInput): Clarification[] {
  const out: Clarification[] = [];
  const seen = new Set<ClarificationSignal>();

  const push = (c: Clarification) => {
    if (seen.has(c.signal)) return;
    seen.add(c.signal);
    out.push(c);
  };

  for (const pat of HIGH_RISK_PATTERNS) {
    if (pat.test(input.prompt)) {
      push({
        id: 'risk-1',
        signal: 'high_risk_keywords',
        question: 'This looks destructive. Are you sure you want to proceed?',
        options: ['proceed', 'preview-only', 'cancel'],
        defaultOption: 'preview-only',
        context: `Detected risky pattern: ${pat.source.slice(0, 60)}`,
      });
      break;
    }
  }

  if (input.memoryConflicts && input.memoryConflicts.length > 0) {
    const first = input.memoryConflicts[0];
    if (first) {
      push({
        id: 'mem-1',
        signal: 'memory_conflict',
        question: `Project memory says "${first.fact}", but your prompt suggests "${first.conflictsWith}". Which should I follow?`,
        options: ['project memory', 'prompt', 'tell me more'],
        defaultOption: 'project memory',
        context: 'Conflict between persisted memory and user prompt',
      });
    }
  }

  for (const pat of OPEN_SCOPE_PATTERNS) {
    if (pat.test(input.prompt)) {
      push({
        id: 'scope-1',
        signal: 'open_scope',
        question:
          'Scope is broad. Want me to pick the most impactful 2 changes first, or sweep everything?',
        options: ['most impactful', 'sweep everything', 'plan first'],
        defaultOption: 'plan first',
        context: `Open-scope phrase: ${pat.source.slice(0, 60)}`,
      });
      break;
    }
  }

  if (input.classification && input.classification.confidence < 0.5) {
    push({
      id: 'conf-1',
      signal: 'low_confidence',
      question: 'I am not sure what you want. Which best matches?',
      options: ['new feature', 'bug fix', 'refactor', 'investigation', 'plan only'],
      defaultOption: 'new feature',
      context: `Classifier confidence ${input.classification.confidence.toFixed(2)}`,
    });
  }

  if (out.length < 2) {
    for (const pat of VAGUE_REFERENCE_PATTERNS) {
      if (pat.test(input.prompt)) {
        push({
          id: 'ref-1',
          signal: 'vague_references',
          question: 'You used a vague reference. Can you point to the specific file / function?',
          context: `Vague phrase: ${pat.source.slice(0, 60)}`,
        });
        break;
      }
    }
  }

  return out.slice(0, 2);
}
