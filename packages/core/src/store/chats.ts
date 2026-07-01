import type { Database } from './db.js';

/**
 * Chat persistence.
 *
 * Until now CodeRouter only stored per-run *metadata* (prompt, route,
 * tokens, cost) — never the model's response text or the multi-turn
 * conversation. These two tables make conversations first-class so the
 * desktop app can browse every chat across every project. A session
 * groups the turns of one REPL/agent conversation; messages hold the
 * actual user/assistant text, optionally linked to the run that
 * produced them.
 */

export type ChatSession = {
  id: string;
  cwd: string;
  title: string;
  mode: string;
  messageCount: number;
  costUsd: number;
  createdAt: number;
  updatedAt: number;
};

export type ChatMessageRecord = {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  runId: string | null;
  route: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  createdAt: number;
};

type SessionRow = {
  id: string;
  cwd: string;
  title: string;
  mode: string;
  message_count: number;
  cost_usd: number;
  created_at: number;
  updated_at: number;
};

type MessageRow = {
  id: number;
  session_id: string;
  role: string;
  text: string;
  run_id: string | null;
  route: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  created_at: number;
};

export class ChatStore {
  constructor(private readonly db: Database) {}

  /** Create a session row if it doesn't exist yet (idempotent). */
  ensureSession(s: { id: string; cwd: string; title?: string; mode: string }): void {
    const existing = this.db.prepare('SELECT id FROM chat_sessions WHERE id = ?').get(s.id);
    if (existing) return;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO chat_sessions (id, cwd, title, mode, message_count, cost_usd, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
      )
      .run(s.id, s.cwd, s.title ?? 'New chat', s.mode, now, now);
  }

  setTitle(id: string, title: string): void {
    this.db.prepare('UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id);
  }

  appendMessage(m: Omit<ChatMessageRecord, 'id' | 'createdAt'> & { createdAt?: number }): void {
    const createdAt = m.createdAt ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO chat_messages (session_id, role, text, run_id, route, tokens_in, tokens_out, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.sessionId,
        m.role,
        m.text,
        m.runId,
        m.route,
        m.tokensIn,
        m.tokensOut,
        m.costUsd,
        createdAt,
      );
    this.db
      .prepare(
        `UPDATE chat_sessions SET message_count = message_count + 1, cost_usd = cost_usd + ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(m.costUsd, createdAt, m.sessionId);
  }

  listSessions(limit = 200): ChatSession[] {
    const rows = this.db
      .prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as SessionRow[];
    return rows.map(rowToSession);
  }

  getSession(id: string): ChatSession | undefined {
    const row = this.db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : undefined;
  }

  messages(sessionId: string): ChatMessageRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC')
      .all(sessionId) as MessageRow[];
    return rows.map(rowToMessage);
  }

  /**
   * Permanently remove a chat session and all of its messages. Returns
   * true when a session was actually deleted. Runs linked to the session
   * are left intact (usage history stays accurate); only the browsable
   * conversation is dropped.
   */
  deleteSession(id: string): boolean {
    this.db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(id);
    const res = this.db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
    return Number(res.changes ?? 0) > 0;
  }
}

function rowToSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    cwd: row.cwd,
    title: row.title,
    mode: row.mode,
    messageCount: row.message_count,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: MessageRow): ChatMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as ChatMessageRecord['role'],
    text: row.text,
    runId: row.run_id,
    route: row.route,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  };
}
