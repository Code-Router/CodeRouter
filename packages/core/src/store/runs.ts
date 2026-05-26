import type { Mode, RouteRef, RunOutcome, TaskType, ValidatorResult } from '../types.js';
import type { Database } from './db.js';

export type RunRecord = {
  id: string;
  sessionId: string | null;
  mode: Mode;
  taskType: TaskType | null;
  prompt: string;
  status: RunOutcome['status'];
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  routes: RouteRef[];
  rationale: string;
  diff: string | null;
  filesChanged: string[];
  validators: ValidatorResult[];
  effectiveness: number | null;
  rating: number | null;
  createdAt: number;
};

export type RunRow = {
  id: string;
  session_id: string | null;
  mode: string;
  task_type: string | null;
  prompt: string;
  status: string;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  duration_ms: number;
  routes_json: string;
  rationale: string;
  diff: string | null;
  files_changed_json: string;
  validators_json: string;
  effectiveness: number | null;
  rating: number | null;
  created_at: number;
};

export class RunStore {
  constructor(private readonly db: Database) {}

  insert(rec: RunRecord): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, session_id, mode, task_type, prompt, status,
          cost_usd, tokens_in, tokens_out, duration_ms, routes_json, rationale,
          diff, files_changed_json, validators_json, effectiveness, rating, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.id,
        rec.sessionId,
        rec.mode,
        rec.taskType,
        rec.prompt,
        rec.status,
        rec.costUsd,
        rec.tokensIn,
        rec.tokensOut,
        rec.durationMs,
        JSON.stringify(rec.routes),
        rec.rationale,
        rec.diff,
        JSON.stringify(rec.filesChanged),
        JSON.stringify(rec.validators),
        rec.effectiveness,
        rec.rating,
        rec.createdAt,
      );
  }

  setRating(id: string, rating: number): void {
    this.db.prepare('UPDATE runs SET rating = ? WHERE id = ?').run(rating, id);
  }

  list(limit = 50): RunRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as RunRow[];
    return rows.map(rowToRecord);
  }

  get(id: string): RunRecord | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  /** Recent route success/failure counts; used by router/routingbias. */
  routeStats(taskType: TaskType): { route: string; total: number; failed: number }[] {
    const rows = this.db
      .prepare(
        `SELECT routes_json, status FROM runs WHERE task_type = ? ORDER BY created_at DESC LIMIT 200`,
      )
      .all(taskType) as { routes_json: string; status: string }[];
    const tally = new Map<string, { total: number; failed: number }>();
    for (const r of rows) {
      const routes = JSON.parse(r.routes_json) as RouteRef[];
      const key = routes.map((rt) => `${rt.provider},${rt.model}`).join(' -> ');
      if (!key) continue;
      const cur = tally.get(key) ?? { total: 0, failed: 0 };
      cur.total += 1;
      if (r.status === 'failed' || r.status === 'partial') cur.failed += 1;
      tally.set(key, cur);
    }
    return [...tally.entries()].map(([route, v]) => ({ route, ...v }));
  }
}

function rowToRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    mode: row.mode as Mode,
    taskType: row.task_type as TaskType | null,
    prompt: row.prompt,
    status: row.status as RunOutcome['status'],
    costUsd: row.cost_usd,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    durationMs: row.duration_ms,
    routes: JSON.parse(row.routes_json) as RouteRef[],
    rationale: row.rationale,
    diff: row.diff,
    filesChanged: JSON.parse(row.files_changed_json) as string[],
    validators: JSON.parse(row.validators_json) as ValidatorResult[],
    effectiveness: row.effectiveness,
    rating: row.rating,
    createdAt: row.created_at,
  };
}
