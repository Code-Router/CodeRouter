import type { CognitiveShape } from '../types.js';
import type { ClassifierInput, ClassifierStageResult } from './types.js';

/**
 * Stage 1 of the cascade. Pure regex + heuristic shape axes; never makes
 * a network call. Returns null if it cannot confidently classify (so the
 * next stage gets a shot). Budget: <10ms.
 *
 * The heuristic shape axes match the seed corpus labels: deepReasoning,
 * multiFileTaste, hugeContext, adversarial, algorithmic, exploratory.
 */

const RULES: {
  pattern: RegExp;
  taskType: ClassifierStageResult['taskType'];
  shape: Partial<CognitiveShape>;
  rationale: string;
  confidence: number;
}[] = [
  {
    pattern: /\b(fix typo|format|prettier|biome format|add comment|remove comment)\b/i,
    taskType: 'trivial',
    shape: { exploratory: 0, deepReasoning: 0, multiFileTaste: 0.1 },
    rationale: "rule:trivial - mechanical edit (typo/format)",
    confidence: 0.95,
  },
  {
    pattern: /\brename\s+(?!.*\b(across|throughout|everywhere|entire|whole|repo|codebase)\b).*\bto\b/i,
    taskType: 'trivial',
    shape: { exploratory: 0, deepReasoning: 0, multiFileTaste: 0.2 },
    rationale: 'rule:trivial - local rename',
    confidence: 0.9,
  },
  {
    pattern: /\brename\s+\w+\s+to\s+\w+\s+(across|throughout|everywhere|in (every|all|the entire)|in the (entire )?(repo|codebase|monorepo))/i,
    taskType: 'refactor',
    shape: { multiFileTaste: 0.9, deepReasoning: 0.5 },
    rationale: 'rule:refactor - cross-repo rename',
    confidence: 0.9,
  },
  {
    pattern: /\b(commit message|changelog entry|release notes)\b/i,
    taskType: 'docs',
    shape: { exploratory: 0, deepReasoning: 0.1, multiFileTaste: 0 },
    rationale: 'rule:docs - commit/release docs',
    confidence: 0.9,
  },
  {
    pattern: /\b(write|update|improve|add|document)\b.*\b(README|docs?|documentation|comment|jsdoc|docstring|public\s+api|module\s+docs)\b/i,
    taskType: 'docs',
    shape: { exploratory: 0.2, multiFileTaste: 0.3 },
    rationale: 'rule:docs - documentation update',
    confidence: 0.8,
  },
  {
    pattern:
      /\b(add|write|create).*(unit\s*test|integration\s*test|e2e\s*test|tests?\s*for|test\s*coverage)\b/i,
    taskType: 'test',
    shape: { multiFileTaste: 0.4, deepReasoning: 0.3, adversarial: 0.6 },
    rationale: 'rule:test - new test creation',
    confidence: 0.8,
  },
  {
    pattern: /\b(debug|root cause|why is .* failing|investigate|diagnose)\b/i,
    taskType: 'investigation',
    shape: { deepReasoning: 0.85, adversarial: 0.4, multiFileTaste: 0.5 },
    rationale: 'rule:investigation - debug / root-cause keywords',
    confidence: 0.7,
  },
  {
    pattern:
      /\b(TypeError|ReferenceError|SyntaxError|RangeError|InternalError|stack\s*trace|traceback)\b|at \S+\.(?:js|ts|tsx|jsx|py|go|rs):\d+/i,
    taskType: 'bugfix',
    shape: { deepReasoning: 0.7, adversarial: 0.5, multiFileTaste: 0.4 },
    rationale: 'rule:bugfix - explicit error/stack-frame in prompt',
    confidence: 0.85,
  },
  {
    pattern: /\b(review|critique|audit|second opinion|nitpick)\b.*\b(diff|pr|change|patch)\b/i,
    taskType: 'review',
    shape: { adversarial: 0.85, multiFileTaste: 0.5 },
    rationale: 'rule:review - PR/diff review request',
    confidence: 0.7,
  },
  {
    pattern: /\b(refactor|extract|split|consolidate|reshape|restructure|move .* to)\b/i,
    taskType: 'refactor',
    shape: { multiFileTaste: 0.8, deepReasoning: 0.5 },
    rationale: 'rule:refactor - structural changes',
    confidence: 0.7,
  },
  {
    pattern:
      /\b(fix|resolve|bug|broken|crash|error|exception|undefined|null|infinite loop|race condition)\b/i,
    taskType: 'bugfix',
    shape: { deepReasoning: 0.5, adversarial: 0.5, multiFileTaste: 0.4 },
    rationale: 'rule:bugfix - failure language',
    confidence: 0.65,
  },
  {
    pattern: /\b(implement|build|add|create|introduce).*(feature|endpoint|api|page|component|service)\b/i,
    taskType: 'feature',
    shape: { multiFileTaste: 0.7, exploratory: 0.5, deepReasoning: 0.4 },
    rationale: 'rule:feature - implementation language',
    confidence: 0.6,
  },
];

/**
 * Layered heuristic shape boosters. Applied to the candidate shape before
 * we return, so a feature prompt that mentions an algorithm gets the
 * algorithmic axis boosted even when the dominant rule is `feature`.
 */
const SHAPE_BOOSTERS: { pattern: RegExp; shape: Partial<CognitiveShape>; reason: string }[] = [
  {
    pattern: /\b(huge|large|big|long)?\s*(file|codebase|monorepo)\b.*\b(scan|sweep|across|all over)\b/i,
    shape: { hugeContext: 0.8 },
    reason: 'hugeContext: cross-file scan',
  },
  {
    pattern: /\b(algorithm|complexity|big\s?o|optimi[sz]e|memoiz|cache|dp\b)/i,
    shape: { algorithmic: 0.8, deepReasoning: 0.6 },
    reason: 'algorithmic: complexity / optimization',
  },
  {
    pattern: /\b(security|vulnerab|injection|xss|csrf|auth|jwt|oauth|sso|sanitize|escape)\b/i,
    shape: { adversarial: 0.8, deepReasoning: 0.6 },
    reason: 'adversarial: security context',
  },
  {
    pattern: /\b(architecture|design|tradeoffs|trade-?offs|approach|strategy)\b/i,
    shape: { deepReasoning: 0.8, exploratory: 0.7 },
    reason: 'deepReasoning: architectural language',
  },
];

const DEFAULT_SHAPE: CognitiveShape = {
  deepReasoning: 0.3,
  multiFileTaste: 0.3,
  hugeContext: 0.1,
  adversarial: 0.2,
  algorithmic: 0.1,
  exploratory: 0.3,
};

export function classifyByRules(input: ClassifierInput): ClassifierStageResult | null {
  const prompt = input.prompt;
  let chosen: (typeof RULES)[number] | null = null;
  for (const r of RULES) {
    if (r.pattern.test(prompt)) {
      if (!chosen || r.confidence > chosen.confidence) chosen = r;
    }
  }
  if (!chosen) return null;

  const shape: CognitiveShape = { ...DEFAULT_SHAPE, ...chosen.shape };
  const rationale: string[] = [chosen.rationale];

  for (const boost of SHAPE_BOOSTERS) {
    if (boost.pattern.test(prompt)) {
      rationale.push(boost.reason);
      for (const [k, v] of Object.entries(boost.shape) as [keyof CognitiveShape, number][]) {
        shape[k] = Math.max(shape[k], v);
      }
    }
  }

  return {
    stage: 'rules',
    confidence: chosen.confidence,
    taskType: chosen.taskType,
    shape,
    rationale: rationale.join('; '),
  };
}
