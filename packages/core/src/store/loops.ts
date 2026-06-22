import type { LoopIteration, LoopRecord, LoopSpec, LoopStatus, VerifierResult } from '../loops/types.js';
import type { Database } from './db.js';

type LoopRow = {
  id: string;
  name: string;
  goal: string;
  cwd: string;
  status: string;
  spec_json: string;
  iterations_done: number;
  cost_usd: number;
  files_changed_json: string;
  last_diff: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

type IterationRow = {
  id: string;
  loop_id: string;
  idx: number;
  run_id: string | null;
  phase: string;
  status: string;
  verifier_json: string;
  diff: string | null;
  summary: string;
  cost_usd: number;
  created_at: number;
};

/** Persistence for generated/running loops and their iterations. */
export class LoopStore {
  constructor(private readonly db: Database) {}

  insert(rec: LoopRecord): void {
    this.db
      .prepare(
        `INSERT INTO loops (id, name, goal, cwd, status, spec_json, iterations_done,
          cost_usd, files_changed_json, last_diff, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.id,
        rec.name,
        rec.goal,
        rec.cwd,
        rec.status,
        JSON.stringify(rec.spec),
        rec.iterationsDone,
        rec.costUsd,
        JSON.stringify(rec.filesChanged),
        rec.lastDiff,
        rec.error,
        rec.createdAt,
        rec.updatedAt,
      );
  }

  update(rec: LoopRecord): void {
    this.db
      .prepare(
        `UPDATE loops SET name = ?, goal = ?, status = ?, spec_json = ?, iterations_done = ?,
          cost_usd = ?, files_changed_json = ?, last_diff = ?, error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        rec.name,
        rec.goal,
        rec.status,
        JSON.stringify(rec.spec),
        rec.iterationsDone,
        rec.costUsd,
        JSON.stringify(rec.filesChanged),
        rec.lastDiff,
        rec.error,
        Date.now(),
        rec.id,
      );
  }

  setStatus(id: string, status: LoopStatus): void {
    this.db.prepare('UPDATE loops SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
  }

  get(id: string): LoopRecord | undefined {
    const row = this.db.prepare('SELECT * FROM loops WHERE id = ?').get(id) as LoopRow | undefined;
    return row ? rowToLoop(row) : undefined;
  }

  list(limit = 100): LoopRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM loops ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as LoopRow[];
    return rows.map(rowToLoop);
  }

  /** Loops that were mid-flight when the daemon stopped (for resume on boot). */
  listResumable(): LoopRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM loops WHERE status IN ('running','queued') ORDER BY updated_at DESC`)
      .all() as LoopRow[];
    return rows.map(rowToLoop);
  }

  insertIteration(it: LoopIteration): void {
    this.db
      .prepare(
        `INSERT INTO loop_iterations (id, loop_id, idx, run_id, phase, status,
          verifier_json, diff, summary, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        it.id,
        it.loopId,
        it.index,
        it.runId,
        it.phase,
        it.status,
        JSON.stringify(it.verifier),
        it.diff,
        it.summary,
        it.costUsd,
        it.createdAt,
      );
  }

  iterations(loopId: string): LoopIteration[] {
    const rows = this.db
      .prepare('SELECT * FROM loop_iterations WHERE loop_id = ? ORDER BY idx ASC, created_at ASC')
      .all(loopId) as IterationRow[];
    return rows.map(rowToIteration);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM loop_iterations WHERE loop_id = ?').run(id);
    this.db.prepare('DELETE FROM loops WHERE id = ?').run(id);
  }
}

function rowToLoop(row: LoopRow): LoopRecord {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    cwd: row.cwd,
    status: row.status as LoopStatus,
    spec: JSON.parse(row.spec_json) as LoopSpec,
    iterationsDone: row.iterations_done,
    costUsd: row.cost_usd,
    filesChanged: JSON.parse(row.files_changed_json) as string[],
    lastDiff: row.last_diff,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToIteration(row: IterationRow): LoopIteration {
  return {
    id: row.id,
    loopId: row.loop_id,
    index: row.idx,
    runId: row.run_id,
    phase: row.phase as LoopIteration['phase'],
    status: row.status as LoopIteration['status'],
    verifier: JSON.parse(row.verifier_json) as VerifierResult[],
    diff: row.diff,
    summary: row.summary,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  };
}
