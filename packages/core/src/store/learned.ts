import { createHash } from 'node:crypto';
import { vectorize, type Vec } from '../classify/embed.js';
import type { CognitiveShape, TaskType } from '../types.js';
import type { Database } from './db.js';

export type LearnedExampleRecord = {
  id?: number;
  prompt: string;
  taskType: TaskType;
  shape: CognitiveShape;
  sourceRunId?: string;
  embedSignature?: string;
  createdAt?: number;
};

/**
 * Stores classification ground truth gathered from runs (data flywheel).
 *
 * Dedup strategy: each example carries a short signature derived from a
 * hashed top-K token bag. Two prompts producing the same signature are
 * considered duplicates and the new write is ignored. This lets us add
 * the seed corpus + every successful run without blowing up the kNN
 * latency budget.
 */
export class LearnedStore {
  constructor(private readonly db: Database) {}

  insert(rec: LearnedExampleRecord): boolean {
    const sig = rec.embedSignature ?? signatureFor(rec.prompt);
    const exists = this.db
      .prepare('SELECT id FROM learned_examples WHERE embed_signature = ?')
      .get(sig) as { id: number } | undefined;
    if (exists) return false;
    this.db
      .prepare(
        `INSERT INTO learned_examples (prompt, task_type, shape_json, source_run_id, embed_signature, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.prompt,
        rec.taskType,
        JSON.stringify(rec.shape),
        rec.sourceRunId ?? null,
        sig,
        rec.createdAt ?? Date.now(),
      );
    return true;
  }

  list(limit = 1000): LearnedExampleRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM learned_examples ORDER BY id DESC LIMIT ?')
      .all(limit) as {
      id: number;
      prompt: string;
      task_type: string;
      shape_json: string;
      source_run_id: string | null;
      embed_signature: string | null;
      created_at: number;
    }[];
    return rows.map((row) => ({
      id: row.id,
      prompt: row.prompt,
      taskType: row.task_type as TaskType,
      shape: JSON.parse(row.shape_json) as CognitiveShape,
      sourceRunId: row.source_run_id ?? undefined,
      embedSignature: row.embed_signature ?? undefined,
      createdAt: row.created_at,
    }));
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM learned_examples').get() as
      | { c: number }
      | undefined;
    return row?.c ?? 0;
  }
}

/**
 * Cheap collision-resistant signature: top-K tokens by vectorized weight,
 * joined and hashed. This dedups paraphrased prompts (e.g. "fix typo" vs
 * "fix the typo") while keeping different intents separate.
 */
export function signatureFor(prompt: string, topK: number = 6): string {
  const vec: Vec = vectorize(prompt);
  const tokens = [...vec.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([t]) => t)
    .sort()
    .join('|');
  return createHash('sha256').update(tokens).digest('hex').slice(0, 16);
}
