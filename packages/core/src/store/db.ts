import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// node:sqlite is a built-in stable in Node 24. Loaded via createRequire so
// the Vite/Vitest dev resolver (which mishandles the `node:` protocol on
// some built-ins) cannot strip the prefix and try to resolve a userland
// `sqlite` package. In production this is just `require('node:sqlite')`.
const requireFromHere = createRequire(import.meta.url);
const sqlite = requireFromHere('node:sqlite') as typeof import('node:sqlite');
const { DatabaseSync } = sqlite;
type DatabaseSyncInstance = import('node:sqlite').DatabaseSync;
type StatementSync = import('node:sqlite').StatementSync;

/**
 * Thin wrapper over node:sqlite (Node 22.5+ stable in 24).
 *
 * Why node:sqlite and not better-sqlite3? Native compilation against
 * Node 24 + Apple SDKs is fragile; the built-in module gives us the
 * same synchronous API with zero install pain. Migrations are version
 * tracked in `pragma user_version`.
 */
export class Database {
  private readonly db: DatabaseSyncInstance;
  private readonly stmtCache = new Map<string, StatementSync>();

  constructor(public readonly path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
  }

  /** Lazy-cached prepared statement. */
  prepare(sql: string): StatementSync {
    const cached = this.stmtCache.get(sql);
    if (cached) return cached;
    const fresh = this.db.prepare(sql);
    this.stmtCache.set(sql, fresh);
    return fresh;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  userVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    return row?.user_version ?? 0;
  }

  setUserVersion(v: number): void {
    this.db.exec(`PRAGMA user_version = ${v}`);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}

export async function openDatabase(path: string): Promise<Database> {
  await mkdir(dirname(path), { recursive: true });
  return new Database(path);
}

/**
 * Resolves the path to the project-scoped sqlite db. We anchor to the
 * git repo root when present so the file lives at `.coderouter/memory.db`,
 * which is the contract documented in the plan.
 */
export function resolveDbPath(repoRoot: string): string {
  return join(repoRoot, '.coderouter', 'memory.db');
}
