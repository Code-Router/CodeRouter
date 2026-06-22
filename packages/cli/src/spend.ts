import { existsSync } from 'node:fs';
import { listProjects, openStore, resolveDbPath } from '@coderouter/core';
import { getEffectiveSpendingLimit } from './ui/setup.js';

/** `YYYY-MM` key for a timestamp in local time (matches the dashboard). */
function localMonthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Total spend (USD) for the current calendar month across every CodeRouter
 * project registered on this machine. Spending is account-wide because API
 * keys and billing are account-wide, so the cap is enforced globally.
 */
export async function getMonthlySpendUsd(extraCwd?: string): Promise<number> {
  const dbPaths = new Set<string>();
  for (const p of listProjects()) dbPaths.add(p.dbPath);
  if (extraCwd) {
    const dp = resolveDbPath(extraCwd);
    if (existsSync(dp)) dbPaths.add(dp);
  }

  const monthKey = localMonthKey(Date.now());
  let total = 0;
  for (const path of dbPaths) {
    if (!existsSync(path)) continue;
    const store = await openStore(path);
    try {
      for (const r of store.runs.list(5000)) {
        if (localMonthKey(r.createdAt) === monthKey) total += r.costUsd;
      }
    } finally {
      try {
        store.db.close();
      } catch {
        /* best-effort */
      }
    }
  }
  return total;
}

/** Thrown when a run is blocked because the monthly spending cap is reached. */
export class SpendingLimitError extends Error {
  constructor(
    public spentUsd: number,
    public limitUsd: number,
  ) {
    super(
      `Monthly spending limit reached: $${spentUsd.toFixed(2)} of $${limitUsd.toFixed(2)} used this month. ` +
        `Raise or remove the cap in Settings → Spending to continue.`,
    );
    this.name = 'SpendingLimitError';
  }
}

/**
 * Throw `SpendingLimitError` if this month's spend already meets or exceeds
 * the effective monthly cap. Call before starting any billable work.
 */
export async function assertWithinSpendingLimit(cwd?: string): Promise<void> {
  const limit = getEffectiveSpendingLimit();
  const spent = await getMonthlySpendUsd(cwd);
  if (spent >= limit) throw new SpendingLimitError(spent, limit);
}
