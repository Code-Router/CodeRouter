import type { Database } from './db.js';

export type SessionRecord = {
  id: string;
  mode: string;
  worktreePath: string | null;
  classificationJson: string | null;
  costAccumulated: number;
  tokensIn: number;
  tokensOut: number;
  lastDiff: string | null;
  handoffHistoryJson: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
};

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

export class SessionStore {
  constructor(private readonly db: Database) {}

  upsert(rec: Omit<SessionRecord, 'createdAt' | 'updatedAt' | 'expiresAt'> & { ttlMs?: number }): void {
    const now = Date.now();
    const ttl = rec.ttlMs ?? DEFAULT_TTL_MS;
    const expiresAt = now + ttl;
    this.db
      .prepare(
        `INSERT INTO sessions (id, mode, worktree_path, classification_json,
          cost_accumulated, tokens_in, tokens_out, last_diff, handoff_history_json,
          expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           mode = excluded.mode,
           worktree_path = excluded.worktree_path,
           classification_json = excluded.classification_json,
           cost_accumulated = excluded.cost_accumulated,
           tokens_in = excluded.tokens_in,
           tokens_out = excluded.tokens_out,
           last_diff = excluded.last_diff,
           handoff_history_json = excluded.handoff_history_json,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at;
        `,
      )
      .run(
        rec.id,
        rec.mode,
        rec.worktreePath,
        rec.classificationJson,
        rec.costAccumulated,
        rec.tokensIn,
        rec.tokensOut,
        rec.lastDiff,
        rec.handoffHistoryJson,
        expiresAt,
        now,
        now,
      );
  }

  get(id: string): SessionRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?')
      .get(id, Date.now()) as
      | (Omit<SessionRecord, 'workreePath'> & {
          worktree_path: string | null;
          classification_json: string | null;
          cost_accumulated: number;
          tokens_in: number;
          tokens_out: number;
          last_diff: string | null;
          handoff_history_json: string;
          expires_at: number;
          created_at: number;
          updated_at: number;
        })
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      mode: row.mode,
      worktreePath: row.worktree_path,
      classificationJson: row.classification_json,
      costAccumulated: row.cost_accumulated,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      lastDiff: row.last_diff,
      handoffHistoryJson: row.handoff_history_json,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  /** Removes sessions whose TTL has passed. */
  prune(now: number = Date.now()): number {
    const res = this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    return Number(res.changes ?? 0);
  }
}
