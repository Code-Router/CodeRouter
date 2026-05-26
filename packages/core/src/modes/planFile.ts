import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import YAML from 'yaml';
import type { Citation, Effort } from '../types.js';

/**
 * `.coderouter/plans/<id>.plan.md` format.
 *
 * YAML frontmatter holds plan metadata + an ordered list of phases with
 * verifier commands. The markdown body holds the plan prose with inline
 * citations and a References section. `coderouter execute <id>` runs
 * the phases sequentially and gates progression on each phase's
 * verifier exit code.
 */

export type PlanPhase = {
  id: string;
  title: string;
  intent: string;
  /** Optional shell command run after the phase to verify success. */
  verifier?: string;
  /** Files this phase is expected to touch (advisory; not enforced). */
  filesHint?: string[];
  /** Marker for plan executor. */
  status?: 'pending' | 'in_progress' | 'done' | 'skipped' | 'failed';
};

export type PlanFrontmatter = {
  planId: string;
  runId: string;
  status: 'draft' | 'ready' | 'executing' | 'done' | 'failed';
  route: string;
  estimatedCostUsd: number;
  createdAt: string;
  effort: Effort;
  phases: PlanPhase[];
};

export type PlanFile = {
  frontmatter: PlanFrontmatter;
  body: string;
  citations: Citation[];
};

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

export async function loadPlanFile(path: string): Promise<PlanFile> {
  const raw = await readFile(path, 'utf8');
  return parsePlanFile(raw);
}

export function parsePlanFile(raw: string): PlanFile {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m || !m[1] || m[2] === undefined) {
    throw new Error('parsePlanFile: missing or malformed YAML frontmatter');
  }
  const fm = YAML.parse(m[1]) as PlanFrontmatter & { citations?: Citation[] };
  const body = m[2];
  const citations = fm.citations ?? [];
  // Don't keep the citations array doubled in frontmatter once parsed
  const cleanFm: PlanFrontmatter = {
    planId: fm.planId,
    runId: fm.runId,
    status: fm.status,
    route: fm.route,
    estimatedCostUsd: fm.estimatedCostUsd,
    createdAt: fm.createdAt,
    effort: fm.effort,
    phases: fm.phases ?? [],
  };
  return { frontmatter: cleanFm, body, citations };
}

export function renderPlanFile(plan: PlanFile): string {
  const fm = {
    ...plan.frontmatter,
    citations: plan.citations,
  };
  return `---\n${YAML.stringify(fm).trim()}\n---\n${plan.body}`;
}

export async function savePlanFile(repoRoot: string, plan: PlanFile): Promise<string> {
  const dest = join(repoRoot, '.coderouter', 'plans', `${plan.frontmatter.planId}.plan.md`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, renderPlanFile(plan), 'utf8');
  return dest;
}

export function newEmptyPlanFile(args: Pick<PlanFrontmatter, 'planId' | 'runId' | 'route' | 'effort'>): PlanFile {
  return {
    frontmatter: {
      planId: args.planId,
      runId: args.runId,
      status: 'draft',
      route: args.route,
      estimatedCostUsd: 0,
      createdAt: new Date().toISOString(),
      effort: args.effort,
      phases: [],
    },
    body: '',
    citations: [],
  };
}
