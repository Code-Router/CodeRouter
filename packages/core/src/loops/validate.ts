import type { LoopSpec, LoopValidation } from './types.js';

/**
 * Loop validator.
 *
 * The single most important design rule: never let the AI generate an
 * unbounded loop. A valid loop MUST carry an objective verifier, an
 * iteration cap, a cost cap, file restrictions, and a clear goal. This
 * gate runs before a loop can be approved/run.
 */

const VAGUE_GOAL_PATTERNS = [
  /\bimprove the (app|code|codebase|project)\b/i,
  /\bmake (it|the code|things) better\b/i,
  /\bclean ?up everything\b/i,
  /\buntil (it'?s )?good\b/i,
  /\boptimi[sz]e everything\b/i,
];

// Commands we refuse to run as part of an automated loop verifier.
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bsudo\b/,
  /\bcurl\b[^|]*\|\s*(sh|bash)\b/,
  /\bnpm\s+publish\b/,
  /\bdocker\s+(push|rmi)\b/,
  /\b(shutdown|reboot|mkfs)\b/,
  />\s*\/dev\/sd/,
];

export function validateLoopSpec(spec: LoopSpec): LoopValidation {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!spec) return { valid: false, issues: ['No loop spec was produced.'], warnings };

  if (!spec.goal || spec.goal.trim().length < 8) {
    issues.push('Goal is missing or too short.');
  } else if (VAGUE_GOAL_PATTERNS.some((re) => re.test(spec.goal))) {
    issues.push(`Goal is too broad: "${spec.goal.trim()}". Narrow it to a verifiable outcome.`);
  }

  const commands = spec.verifier?.commands ?? [];
  if (commands.length === 0) {
    issues.push('No verifier command was found. A loop must have an objective gate (e.g. tests).');
  }
  for (const cmd of commands) {
    if (DANGEROUS_COMMAND_PATTERNS.some((re) => re.test(cmd))) {
      issues.push(`Dangerous command rejected: "${cmd}".`);
    }
  }
  if (!spec.verifier?.successCondition?.trim()) {
    warnings.push('No explicit success condition; defaulting to "all verifier commands exit 0".');
  }

  const limits = spec.limits;
  if (!limits || !Number.isFinite(limits.maxIterations) || limits.maxIterations <= 0) {
    issues.push('No max iteration limit set.');
  } else if (limits.maxIterations > 50) {
    warnings.push(`Max iterations is high (${limits.maxIterations}); consider lowering.`);
  }
  if (!limits || !Number.isFinite(limits.maxCostUsd) || limits.maxCostUsd <= 0) {
    issues.push('No max cost limit set.');
  }
  if (!limits || !Number.isFinite(limits.maxFilesChanged) || limits.maxFilesChanged <= 0) {
    issues.push('No max-files-changed limit set.');
  } else if (limits.maxFilesChanged > 100) {
    warnings.push(`Editable file budget is very large (${limits.maxFilesChanged}).`);
  }

  if (!spec.safety) {
    issues.push('No safety section (blocked files / approval policy).');
  } else {
    if (!Array.isArray(spec.safety.blockedFiles) || spec.safety.blockedFiles.length === 0) {
      warnings.push('No blocked files configured; secrets/lockfiles are normally protected.');
    }
    if (!spec.safety.requireApprovalBeforeCommit) {
      warnings.push('Loop will commit without human approval.');
    }
  }

  if (!spec.models?.executor) warnings.push('No executor model role set; defaulting to coding tier.');

  return { valid: issues.length === 0, issues, warnings };
}
