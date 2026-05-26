import type { Database } from './db.js';

export type ProjectFact = {
  key: string;
  value: string;
  source: string;
  updatedAt: number;
};

export class FactStore {
  constructor(private readonly db: Database) {}

  set(key: string, value: string, source: string): void {
    this.db
      .prepare(
        `INSERT INTO project_facts (key, value, source, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, source = excluded.source, updated_at = excluded.updated_at`,
      )
      .run(key, value, source, Date.now());
  }

  get(key: string): ProjectFact | undefined {
    return this.db.prepare('SELECT * FROM project_facts WHERE key = ?').get(key) as
      | ProjectFact
      | undefined;
  }

  list(): ProjectFact[] {
    return this.db.prepare('SELECT * FROM project_facts ORDER BY key').all() as ProjectFact[];
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM project_facts WHERE key = ?').run(key);
  }
}

export type OverrideRecord = {
  id?: number;
  promptPattern: string;
  route: string;
  reason: string;
  createdAt?: number;
};

export class OverrideStore {
  constructor(private readonly db: Database) {}

  add(rec: OverrideRecord): void {
    this.db
      .prepare(
        `INSERT INTO overrides (prompt_pattern, route, reason, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(rec.promptPattern, rec.route, rec.reason, rec.createdAt ?? Date.now());
  }

  list(): OverrideRecord[] {
    const rows = this.db.prepare('SELECT * FROM overrides ORDER BY id DESC').all() as {
      id: number;
      prompt_pattern: string;
      route: string;
      reason: string;
      created_at: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      promptPattern: r.prompt_pattern,
      route: r.route,
      reason: r.reason,
      createdAt: r.created_at,
    }));
  }

  matchRoute(prompt: string): OverrideRecord | undefined {
    for (const o of this.list()) {
      try {
        if (new RegExp(o.promptPattern, 'i').test(prompt)) return o;
      } catch {
        // bad pattern, skip
      }
    }
    return undefined;
  }
}

export type FailurePatternRecord = {
  id?: number;
  pattern: string;
  context: string;
  failCount: number;
  lastSeen: number;
};

export class FailurePatternStore {
  constructor(private readonly db: Database) {}

  /** Increments fail_count if the pattern exists, else inserts it. */
  upsert(pattern: string, context: string): void {
    const row = this.db
      .prepare('SELECT id, fail_count FROM failure_patterns WHERE pattern = ? AND context = ?')
      .get(pattern, context) as { id: number; fail_count: number } | undefined;
    if (row) {
      this.db
        .prepare('UPDATE failure_patterns SET fail_count = fail_count + 1, last_seen = ? WHERE id = ?')
        .run(Date.now(), row.id);
      return;
    }
    this.db
      .prepare(
        'INSERT INTO failure_patterns (pattern, context, fail_count, last_seen) VALUES (?, ?, 1, ?)',
      )
      .run(pattern, context, Date.now());
  }

  /** Returns patterns over `threshold` recent failures. Used by HandoffBrief. */
  topFailures(context: string, threshold = 2, limit = 20): FailurePatternRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, pattern, context, fail_count, last_seen
         FROM failure_patterns
         WHERE context = ? AND fail_count >= ?
         ORDER BY fail_count DESC, last_seen DESC
         LIMIT ?`,
      )
      .all(context, threshold, limit) as {
      id: number;
      pattern: string;
      context: string;
      fail_count: number;
      last_seen: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      pattern: r.pattern,
      context: r.context,
      failCount: r.fail_count,
      lastSeen: r.last_seen,
    }));
  }

  clear(): void {
    this.db.exec('DELETE FROM failure_patterns');
  }
}
