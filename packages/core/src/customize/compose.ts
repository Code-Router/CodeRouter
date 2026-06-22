import { loadRules, loadSkills, loadSubagents } from './store.js';
import type { Rule, Skill, Subagent } from './types.js';

/**
 * Build the system-prompt suffix contributed by the user's rules +
 * skills. Returns '' when there's nothing to inject so callers can skip
 * the system-prompt override entirely.
 *
 *   - alwaysApply rules        -> injected verbatim.
 *   - glob-scoped rules        -> listed as conditional rules the model
 *                                 applies when touching matching files.
 *   - skills                   -> name + description + path so the model
 *                                 can read the SKILL.md on demand.
 */
export async function composeDirectives(cwd: string): Promise<string> {
  const [rules, skills] = await Promise.all([loadRules(cwd), loadSkills(cwd)]);
  return renderDirectives(rules, skills);
}

export function renderDirectives(rules: Rule[], skills: Skill[]): string {
  const sections: string[] = [];

  const always = rules.filter((r) => r.alwaysApply && r.body.trim());
  if (always.length > 0) {
    sections.push(
      ['# Project rules (always apply)', ...always.map(renderRule)].join('\n\n'),
    );
  }

  const conditional = rules.filter((r) => !r.alwaysApply && r.globs.length > 0 && r.body.trim());
  if (conditional.length > 0) {
    sections.push(
      [
        '# Conditional rules',
        'Apply each rule below only when you create or edit files matching its globs.',
        ...conditional.map(renderRule),
      ].join('\n\n'),
    );
  }

  if (skills.length > 0) {
    sections.push(
      [
        '# Available skills',
        'When a task matches a skill below, read its file with read_file and follow it.',
        ...skills.map((s) => `- ${s.name}: ${s.description || '(no description)'} — ${s.path}`),
      ].join('\n'),
    );
  }

  return sections.join('\n\n');
}

function renderRule(r: Rule): string {
  const head = r.description || r.id;
  const globs = r.globs.length > 0 ? `  (globs: ${r.globs.join(', ')})` : '';
  return `## ${head}${globs}\n${r.body.trim()}`;
}

/**
 * Pick the subagent best suited to a sub-task. Preference order:
 *   1. explicit name match (the planner named a subagent),
 *   2. `kind` match (a subagent specializes in this kind of work).
 * Returns null when nothing matches.
 */
export function matchSubagent(
  subagents: Subagent[],
  opts: { name?: string; kind?: string },
): Subagent | null {
  if (opts.name) {
    const want = opts.name.toLowerCase();
    const byName = subagents.find(
      (s) => s.name.toLowerCase() === want || s.slug.toLowerCase() === want,
    );
    if (byName) return byName;
  }
  if (opts.kind) {
    const byKind = subagents.find((s) => s.kind && s.kind.toLowerCase() === opts.kind!.toLowerCase());
    if (byKind) return byKind;
  }
  return null;
}

export { loadRules, loadSkills, loadSubagents };
