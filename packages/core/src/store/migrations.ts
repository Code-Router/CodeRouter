import type { Database } from './db.js';

/**
 * Forward-only schema migrations. Each migration runs once per database;
 * we track applied version with `pragma user_version`. Adding a new
 * migration is the only supported way to evolve the schema.
 */

export type Migration = {
  version: number;
  description: string;
  apply: (db: Database) => void;
};

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'initial schema (runs, classifications, learned_examples, project_facts, overrides, failure_patterns, handoff_history, sessions, ratings)',
    apply(db) {
      db.exec(`
        CREATE TABLE runs (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          mode TEXT NOT NULL,
          task_type TEXT,
          prompt TEXT NOT NULL,
          status TEXT NOT NULL,
          cost_usd REAL NOT NULL DEFAULT 0,
          tokens_in INTEGER NOT NULL DEFAULT 0,
          tokens_out INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          routes_json TEXT NOT NULL DEFAULT '[]',
          rationale TEXT NOT NULL DEFAULT '',
          diff TEXT,
          files_changed_json TEXT NOT NULL DEFAULT '[]',
          validators_json TEXT NOT NULL DEFAULT '[]',
          effectiveness REAL,
          rating INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_runs_session ON runs(session_id);
        CREATE INDEX idx_runs_status ON runs(status);
        CREATE INDEX idx_runs_created ON runs(created_at);

        CREATE TABLE classifications (
          hash TEXT PRIMARY KEY,
          prompt TEXT NOT NULL,
          task_type TEXT NOT NULL,
          shape_json TEXT NOT NULL,
          confidence REAL NOT NULL,
          source TEXT NOT NULL,
          rationale TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE learned_examples (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt TEXT NOT NULL,
          task_type TEXT NOT NULL,
          shape_json TEXT NOT NULL,
          source_run_id TEXT,
          embed_signature TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(embed_signature)
        );

        CREATE TABLE project_facts (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          source TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE overrides (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt_pattern TEXT NOT NULL,
          route TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE failure_patterns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pattern TEXT NOT NULL,
          context TEXT NOT NULL,
          fail_count INTEGER NOT NULL DEFAULT 1,
          last_seen INTEGER NOT NULL
        );

        CREATE TABLE handoff_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_run_id TEXT NOT NULL,
          from_route TEXT NOT NULL,
          to_route TEXT NOT NULL,
          reason TEXT NOT NULL,
          outcome TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          mode TEXT NOT NULL,
          worktree_path TEXT,
          classification_json TEXT,
          cost_accumulated REAL NOT NULL DEFAULT 0,
          tokens_in INTEGER NOT NULL DEFAULT 0,
          tokens_out INTEGER NOT NULL DEFAULT 0,
          last_diff TEXT,
          handoff_history_json TEXT NOT NULL DEFAULT '[]',
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
];

export function migrate(db: Database): { from: number; to: number } {
  const from = db.userVersion();
  let to = from;
  db.transaction(() => {
    for (const m of MIGRATIONS) {
      if (m.version > to) {
        m.apply(db);
        db.setUserVersion(m.version);
        to = m.version;
      }
    }
  });
  return { from, to };
}
