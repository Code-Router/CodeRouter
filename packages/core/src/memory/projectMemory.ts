import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { join } from 'node:path';

export type ProjectMemoryFragment = {
  path: string;
  source: 'AGENTS.md' | 'CLAUDE.md' | 'cursorrules' | 'cursor-rule' | 'coderouter';
  /** Priority: lower wins when overlapping facts conflict. */
  priority: number;
  contents: string;
};

export type ProjectMemory = {
  /** Concatenated, ordered fragments (highest priority first). */
  fragments: ProjectMemoryFragment[];
  /** Merged text suitable for inclusion in a system prompt. */
  text: string;
  /** Auto-extracted facts (test framework, pkg manager, etc.). */
  facts: { key: string; value: string; source: string }[];
};

/**
 * Loads L2 project memory in this priority order (matching the plan):
 *
 *   1) AGENTS.md           (top)
 *   2) CLAUDE.md
 *   3) .cursorrules
 *   4) .cursor/rules/*.md
 *   5) .coderouter/memory.md
 *
 * Anything we successfully read becomes a fragment with a numeric
 * priority (1 = top); concatenated text is in priority order so a
 * system prompt seeded with this content respects the user's intent.
 */
export async function loadProjectMemory(cwd: string): Promise<ProjectMemory> {
  const fragments: ProjectMemoryFragment[] = [];

  const tryRead = async (
    path: string,
    source: ProjectMemoryFragment['source'],
    priority: number,
  ) => {
    try {
      const contents = await readFile(path, 'utf8');
      if (contents.trim()) fragments.push({ path, source, priority, contents });
    } catch {
      // missing
    }
  };

  await tryRead(join(cwd, 'AGENTS.md'), 'AGENTS.md', 1);
  await tryRead(join(cwd, 'CLAUDE.md'), 'CLAUDE.md', 2);
  await tryRead(join(cwd, '.cursorrules'), 'cursorrules', 3);

  try {
    const rules: string[] = [];
    for await (const entry of glob('**/*.md', { cwd: join(cwd, '.cursor/rules') })) {
      rules.push(entry);
    }
    for (const rel of rules.sort()) {
      await tryRead(join(cwd, '.cursor/rules', rel), 'cursor-rule', 4);
    }
  } catch {
    // .cursor/rules doesn't exist
  }

  await tryRead(join(cwd, '.coderouter', 'memory.md'), 'coderouter', 5);

  fragments.sort((a, b) => a.priority - b.priority);
  const text = fragments
    .map((f) => `<!-- ${f.path} (priority ${f.priority}) -->\n${f.contents.trim()}\n`)
    .join('\n');

  const facts = extractFacts(fragments);

  return { fragments, text, facts };
}

const FACT_PATTERNS: { key: string; rx: RegExp }[] = [
  { key: 'test-framework', rx: /\b(vitest|jest|pytest|mocha|cargo\s+test|go\s+test)\b/i },
  { key: 'package-manager', rx: /\b(pnpm|npm|yarn|bun)\b/i },
  { key: 'linter', rx: /\b(biome|eslint|ruff|clippy|prettier)\b/i },
  { key: 'language', rx: /\b(typescript|javascript|python|rust|go|kotlin|swift)\b/i },
];

function extractFacts(
  fragments: ProjectMemoryFragment[],
): { key: string; value: string; source: string }[] {
  const out: { key: string; value: string; source: string }[] = [];
  const seen = new Set<string>();
  for (const f of fragments) {
    for (const { key, rx } of FACT_PATTERNS) {
      if (seen.has(key)) continue;
      const m = rx.exec(f.contents);
      if (m?.[1]) {
        out.push({ key, value: m[1].toLowerCase(), source: f.source });
        seen.add(key);
      }
    }
  }
  return out;
}

/**
 * Returns a short, model-friendly summary suitable for inclusion as a
 * `system` prompt. Capped at ~1500 tokens by character truncation; the
 * full memory is still available via `memory.text`.
 */
export function projectMemoryToSystemPrompt(memory: ProjectMemory, maxChars = 6000): string {
  if (!memory.text) return '';
  const truncated = memory.text.length > maxChars ? `${memory.text.slice(0, maxChars)}\n[truncated]` : memory.text;
  return [
    'Project memory (from AGENTS.md / CLAUDE.md / .cursor/rules / .coderouter/memory.md):',
    '',
    truncated,
  ].join('\n');
}
