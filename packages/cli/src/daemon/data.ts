import { basename } from 'node:path';
import {
  discoverProjects,
  listProjects,
  openStore,
  registerProject,
  resolveDbPath,
  type ChatSession,
  type LoopRecord,
  type Store,
} from '@coderouter/core';
import { storeFor } from './supervisor.js';

/**
 * Daemon-only data builders for the new Studio sections: a machine-wide
 * Projects browser and a Chats browser over persisted conversations.
 * Usage/settings/plugins/models keep flowing through the existing
 * dashboard builders (the daemon delegates those routes).
 */

export type ProjectSummary = {
  cwd: string;
  name: string;
  lastSeen: number;
  runs: number;
  loops: number;
  chats: number;
  costUsd: number;
  lastActivity: number;
};

let backfilled = false;

async function ensureBackfill(): Promise<void> {
  if (backfilled) return;
  backfilled = true;
  await discoverProjects().catch(() => []);
}

function countRow(store: Store, sql: string): { c: number; cost: number; last: number } {
  try {
    const row = store.db.prepare(sql).get() as { c?: number; cost?: number; last?: number } | undefined;
    return { c: row?.c ?? 0, cost: row?.cost ?? 0, last: row?.last ?? 0 };
  } catch {
    return { c: 0, cost: 0, last: 0 };
  }
}

export async function buildProjectsReport(cwd: string): Promise<{ projects: ProjectSummary[] }> {
  registerProject(cwd);
  await ensureBackfill();
  const entries = listProjects();
  const projects: ProjectSummary[] = [];
  for (const entry of entries) {
    try {
      const store = await openStore(entry.dbPath);
      const runs = countRow(store, 'SELECT COUNT(*) c, COALESCE(SUM(cost_usd),0) cost, MAX(created_at) last FROM runs');
      const loops = countRow(store, 'SELECT COUNT(*) c, 0 cost, MAX(updated_at) last FROM loops');
      const chats = countRow(store, 'SELECT COUNT(*) c, 0 cost, MAX(updated_at) last FROM chat_sessions');
      projects.push({
        cwd: entry.cwd,
        name: basename(entry.cwd) || entry.cwd,
        lastSeen: entry.lastSeen,
        runs: runs.c,
        loops: loops.c,
        chats: chats.c,
        costUsd: runs.cost,
        lastActivity: Math.max(runs.last, loops.last, chats.last, entry.lastSeen),
      });
    } catch {
      // skip unreadable project db
    }
  }
  projects.sort((a, b) => b.lastActivity - a.lastActivity);
  return { projects };
}

export type ChatSummary = ChatSession & { project: string };

/** All chat sessions across every registered project (most recent first). */
export async function buildChatsReport(cwd: string, projectCwd?: string): Promise<{ chats: ChatSummary[] }> {
  registerProject(cwd);
  await ensureBackfill();
  const entries = projectCwd ? [{ cwd: projectCwd, dbPath: resolveDbPath(projectCwd) }] : listProjects();
  const chats: ChatSummary[] = [];
  for (const entry of entries) {
    try {
      const store = await openStore(entry.dbPath);
      for (const s of store.chats.listSessions(200)) {
        chats.push({ ...s, project: basename(entry.cwd) || entry.cwd });
      }
    } catch {
      // skip
    }
  }
  chats.sort((a, b) => b.updatedAt - a.updatedAt);
  return { chats };
}

export async function buildChatDetail(projectCwd: string, sessionId: string) {
  const store = await storeFor(projectCwd);
  const session = store.chats.getSession(sessionId);
  if (!session) return null;
  return { session, messages: store.chats.messages(sessionId) };
}

/** Loops across every project (for the global Loops list). */
export async function buildAllLoops(cwd: string): Promise<{ loops: Array<LoopRecord & { project: string }> }> {
  registerProject(cwd);
  await ensureBackfill();
  const entries = listProjects();
  const loops: Array<LoopRecord & { project: string }> = [];
  for (const entry of entries) {
    try {
      const store = await openStore(entry.dbPath);
      for (const l of store.loops.list(100)) {
        loops.push({ ...l, project: basename(entry.cwd) || entry.cwd });
      }
    } catch {
      // skip
    }
  }
  loops.sort((a, b) => b.updatedAt - a.updatedAt);
  return { loops };
}
