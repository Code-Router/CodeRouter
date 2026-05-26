import { type Database, openDatabase, resolveDbPath } from './db.js';
import { FactStore, FailurePatternStore, OverrideStore } from './facts.js';
import { LearnedStore } from './learned.js';
import { migrate } from './migrations.js';
import { RunStore } from './runs.js';
import { SessionStore } from './sessions.js';

export * from './db.js';
export * from './facts.js';
export * from './learned.js';
export * from './migrations.js';
export * from './runs.js';
export * from './sessions.js';

export type Store = {
  db: Database;
  runs: RunStore;
  sessions: SessionStore;
  learned: LearnedStore;
  facts: FactStore;
  overrides: OverrideStore;
  failures: FailurePatternStore;
};

/**
 * Opens the project-scoped SQLite database, runs forward-only migrations,
 * and returns a `Store` bundling every entity store.
 *
 * Usage:
 *   const store = await openStore(resolveDbPath(repoRoot));
 *   store.runs.insert(...);
 */
export async function openStore(path: string): Promise<Store> {
  const db = await openDatabase(path);
  migrate(db);
  return {
    db,
    runs: new RunStore(db),
    sessions: new SessionStore(db),
    learned: new LearnedStore(db),
    facts: new FactStore(db),
    overrides: new OverrideStore(db),
    failures: new FailurePatternStore(db),
  };
}

export { resolveDbPath };
