import type { Effort } from '../types.js';

/**
 * Where a customization asset lives. Project assets (in the repo's
 * `.coderouter/`) override global ones (`~/.coderouter/`) of the same
 * identity, so a team can ship project-specific behaviour that wins over
 * a developer's machine-wide defaults.
 */
export type AssetScope = 'project' | 'global';

/**
 * A Rule: a persistent instruction injected into the agent's system
 * prompt. Mirrors Cursor / `.cursor/rules` semantics.
 *
 *   - `alwaysApply: true`  -> injected verbatim on every run.
 *   - `globs` non-empty    -> surfaced as a conditional rule the model
 *     applies when it touches matching files.
 */
export type Rule = {
  id: string;
  scope: AssetScope;
  path: string;
  description: string;
  globs: string[];
  alwaysApply: boolean;
  body: string;
};

/**
 * A Skill: a named capability doc (`SKILL.md`) the agent reads on demand
 * when a task matches its description. We inject the name + description +
 * path into the system prompt so the model knows it exists.
 */
export type Skill = {
  slug: string;
  scope: AssetScope;
  path: string;
  name: string;
  description: string;
  body: string;
};

/**
 * A Subagent: a typed execution preset the orchestrator can route a
 * sub-task to. Optionally pins a model / effort and always contributes
 * its instructions to the sub-task's system prompt.
 */
export type Subagent = {
  slug: string;
  scope: AssetScope;
  path: string;
  name: string;
  description: string;
  /** Sub-task kind this subagent specializes in (matches orchestrate kinds). */
  kind?: string;
  /** Optional pinned provider/model + effort for sub-tasks it handles. */
  provider?: string;
  model?: string;
  effort?: Effort;
  body: string;
};

export type AssetKind = 'rule' | 'skill' | 'subagent';
