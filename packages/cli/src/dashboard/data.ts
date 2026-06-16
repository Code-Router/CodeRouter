/**
 * Dashboard data layer.
 *
 * Pure-ish aggregation over the project store (`.coderouter/memory.db`)
 * plus a read of the global settings file (`~/.coderouter/credentials.json`).
 * The HTTP layer (`server.ts`) is a thin shell around these functions, so
 * all the interesting logic stays here and is unit-testable without a
 * socket.
 *
 * Usage is project-scoped on purpose: every other CodeRouter command keys
 * off `--cwd` and writes runs into that repo's db, so the dashboard mirrors
 * that contract. The header surfaces which project it's reporting on.
 */

import { existsSync, readFileSync } from 'node:fs';
import {
  CATALOG,
  ProviderRegistry,
  defaultProviders,
  openStore,
  resolveDbPath,
} from '@coderouter/core';
import type { RunRecord } from '@coderouter/core/store';
import {
  CREDENTIALS_PATH,
  SETUP_PROVIDERS,
  getPreferredModels,
  getSpendingLimit,
  type SetupProvider,
} from '../ui/setup.js';
import { detectHosts, type DetectedHost } from '../ui/hosts.js';

export type UsageTotals = {
  runs: number;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  costUsd: number;
  /** Cost incurred in the current calendar month (local time). */
  monthCostUsd: number;
  /** `YYYY-MM` key for the month `monthCostUsd` covers. */
  monthKey: string;
  /** 0-1 fraction of runs that ended `success`. */
  successRate: number;
  avgDurationMs: number;
  /** Average user rating across rated runs, or null when none rated. */
  avgRating: number | null;
};

export type BreakdownRow = {
  key: string;
  label: string;
  runs: number;
  tokens: number;
  costUsd: number;
};

export type HeatmapDay = {
  /** ISO date, `YYYY-MM-DD`, local time. */
  date: string;
  runs: number;
  tokens: number;
};

export type RecentRun = {
  id: string;
  createdAt: number;
  mode: string;
  status: string;
  taskType: string | null;
  route: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  durationMs: number;
  rating: number | null;
  prompt: string;
};

export type UsageReport = {
  project: { cwd: string; dbPath: string; hasData: boolean };
  totals: UsageTotals;
  byMode: BreakdownRow[];
  byProvider: BreakdownRow[];
  byTaskType: BreakdownRow[];
  heatmap: HeatmapDay[];
  highlights: {
    mostActiveMonth: string | null;
    mostActiveDay: string | null;
    longestStreakDays: number;
    currentStreakDays: number;
  };
  recentRuns: RecentRun[];
  generatedAt: number;
};

export type ProviderSetting = {
  name: string;
  label: string;
  envVar: string;
  example: string;
  configured: boolean;
  /** Where the key came from: the credentials file, the shell env, or nowhere. */
  source: 'file' | 'shell' | 'none';
  /** Masked preview (e.g. `sk-or-…a1b2`); never the raw key. */
  masked: string | null;
};

export type HostSetting = {
  provider: DetectedHost['provider'];
  label: string;
  cli: string;
  binPath: string;
  blurb: string;
  enabled: boolean;
};

export type AvailableModel = {
  provider: string;
  model: string;
  label: string;
  /** Rough tier hint from the catalog: which intents this model serves. */
  tiers: ('strong' | 'cheap' | 'balanced')[];
};

export type SettingsReport = {
  providers: ProviderSetting[];
  hosts: HostSetting[];
  limits: { monthlyUsd: number | null };
  preferredModels: {
    strong: { provider: string; model: string } | null;
    cheap: { provider: string; model: string } | null;
  };
  availableModels: AvailableModel[];
  paths: { credentials: string; db: string };
};

const HEATMAP_DAYS = 371; // 53 weeks, aligned to whole weeks in the UI.

/**
 * Read every run for the project at `cwd` and fold it into the shape the
 * dashboard renders. Opens the store read-only-ish (we never write) and
 * closes it before returning so we don't hold a WAL handle open for the
 * life of the server.
 */
export async function buildUsageReport(cwd: string): Promise<UsageReport> {
  const dbPath = resolveDbPath(cwd);
  const generatedAt = Date.now();

  if (!existsSync(dbPath)) {
    return emptyReport(cwd, dbPath, generatedAt);
  }

  const store = await openStore(dbPath);
  let runs: RunRecord[];
  try {
    // Large but bounded: enough to cover heavy local usage without
    // unbounded memory. Recent-first from the store; we re-sort where
    // ascending order matters (streaks).
    runs = store.runs.list(5000);
  } finally {
    try {
      store.db.close();
    } catch {
      // best-effort
    }
  }

  if (runs.length === 0) {
    return emptyReport(cwd, dbPath, generatedAt);
  }

  return {
    project: { cwd, dbPath, hasData: true },
    totals: computeTotals(runs),
    byMode: groupBy(runs, (r) => ({ key: r.mode, label: r.mode })),
    byProvider: groupBy(runs, (r) => {
      const primary = r.routes[0];
      const key = primary ? (primary.via ?? primary.provider) : 'unknown';
      const label = primary
        ? `${primary.via ?? primary.provider}${primary.model ? ` · ${primary.model}` : ''}`
        : 'unknown';
      return { key, label };
    }),
    byTaskType: groupBy(runs, (r) => ({
      key: r.taskType ?? 'unclassified',
      label: r.taskType ?? 'unclassified',
    })),
    heatmap: computeHeatmap(runs, generatedAt),
    highlights: computeHighlights(runs),
    recentRuns: runs.slice(0, 50).map(toRecentRun),
    generatedAt,
  };
}

/** Read provider keys (masked) + host enable flags from the global config. */
export function buildSettingsReport(cwd: string): SettingsReport {
  const file = readCredentialsFile();
  const providers: ProviderSetting[] = SETUP_PROVIDERS.map((p) => describeProvider(p, file));
  const hosts: HostSetting[] = detectHosts().map((h) => ({
    provider: h.provider,
    label: h.label,
    cli: h.cli,
    binPath: h.binPath,
    blurb: h.blurb,
    enabled: h.enabled,
  }));
  return {
    providers,
    hosts,
    limits: getSpendingLimit(),
    preferredModels: getPreferredModels(),
    availableModels: listAvailableModels(),
    paths: { credentials: CREDENTIALS_PATH, db: resolveDbPath(cwd) },
  };
}

/**
 * Catalog models the user can actually route to right now — i.e. whose
 * provider is configured + ready. De-duplicated by (provider, model)
 * and tagged with a coarse tier hint so the picker can group them.
 */
function listAvailableModels(): AvailableModel[] {
  const registry = new ProviderRegistry(defaultProviders());
  const seen = new Set<string>();
  const out: AvailableModel[] = [];
  for (const entry of CATALOG) {
    if (!registry.has(entry.provider)) continue;
    if (!registry.isReady(entry.provider)) continue;
    const key = `${entry.provider}:${entry.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tiers = new Set<'strong' | 'cheap' | 'balanced'>();
    for (const b of entry.intents) {
      if (b.intent === 'deep-reasoning' || b.intent === 'multi-file' || b.intent === 'huge-context')
        tiers.add('strong');
      else if (b.intent === 'fast-cheap' || b.intent === 'local-offline') tiers.add('cheap');
      else if (b.intent === 'balanced-agent') tiers.add('balanced');
    }
    out.push({
      provider: entry.provider,
      model: entry.model,
      label: `${entry.provider} · ${entry.model}`,
      tiers: [...tiers],
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

type CredentialsFileShape = {
  providers?: Record<string, { apiKey?: string }>;
};

function readCredentialsFile(): CredentialsFileShape {
  try {
    return JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')) as CredentialsFileShape;
  } catch {
    return {};
  }
}

function describeProvider(p: SetupProvider, file: CredentialsFileShape): ProviderSetting {
  const fileKey = file.providers?.[p.name]?.apiKey?.trim() || undefined;
  const envKey = process.env[p.envVar]?.trim() || undefined;
  // The CLI hydrates file keys into env at startup, so an env hit that
  // differs from the file value is a genuine shell-set key.
  const source: ProviderSetting['source'] = fileKey
    ? 'file'
    : envKey
      ? 'shell'
      : 'none';
  const raw = fileKey ?? envKey ?? null;
  return {
    name: p.name,
    label: p.label,
    envVar: p.envVar,
    example: p.example,
    configured: Boolean(raw),
    source,
    masked: raw ? maskKey(raw) : null,
  };
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function computeTotals(runs: RunRecord[]): UsageTotals {
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  let monthCostUsd = 0;
  let durationMs = 0;
  let successes = 0;
  let ratingSum = 0;
  let ratingCount = 0;
  const monthKey = localDateKey(Date.now()).slice(0, 7);
  for (const r of runs) {
    tokensIn += r.tokensIn;
    tokensOut += r.tokensOut;
    costUsd += r.costUsd;
    if (localDateKey(r.createdAt).slice(0, 7) === monthKey) monthCostUsd += r.costUsd;
    durationMs += r.durationMs;
    if (r.status === 'success') successes++;
    if (typeof r.rating === 'number') {
      ratingSum += r.rating;
      ratingCount++;
    }
  }
  return {
    runs: runs.length,
    tokensIn,
    tokensOut,
    tokens: tokensIn + tokensOut,
    costUsd,
    monthCostUsd,
    monthKey,
    successRate: runs.length > 0 ? successes / runs.length : 0,
    avgDurationMs: runs.length > 0 ? durationMs / runs.length : 0,
    avgRating: ratingCount > 0 ? ratingSum / ratingCount : null,
  };
}

function groupBy(
  runs: RunRecord[],
  keyOf: (r: RunRecord) => { key: string; label: string },
): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const r of runs) {
    const { key, label } = keyOf(r);
    const row = map.get(key) ?? { key, label, runs: 0, tokens: 0, costUsd: 0 };
    row.runs += 1;
    row.tokens += r.tokensIn + r.tokensOut;
    row.costUsd += r.costUsd;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.runs - a.runs);
}

function computeHeatmap(runs: RunRecord[], now: number): HeatmapDay[] {
  const byDate = new Map<string, { runs: number; tokens: number }>();
  for (const r of runs) {
    const date = localDateKey(r.createdAt);
    const cur = byDate.get(date) ?? { runs: 0, tokens: 0 };
    cur.runs += 1;
    cur.tokens += r.tokensIn + r.tokensOut;
    byDate.set(date, cur);
  }
  const out: HeatmapDay[] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (HEATMAP_DAYS - 1));
  for (let i = 0; i < HEATMAP_DAYS; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = localDateKey(d.getTime());
    const hit = byDate.get(key);
    out.push({ date: key, runs: hit?.runs ?? 0, tokens: hit?.tokens ?? 0 });
  }
  return out;
}

function computeHighlights(runs: RunRecord[]): UsageReport['highlights'] {
  const byDay = new Map<string, number>();
  const byMonth = new Map<string, number>();
  for (const r of runs) {
    const day = localDateKey(r.createdAt);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    const month = day.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  }

  const mostActiveDay = topKey(byDay);
  const mostActiveMonth = topKey(byMonth);

  // Streaks: walk the sorted set of active days, counting consecutive
  // calendar days. Current streak is the run ending today or yesterday.
  const activeDays = [...byDay.keys()].sort();
  let longest = 0;
  let running = 0;
  let prev: number | null = null;
  for (const day of activeDays) {
    const ts = Date.parse(`${day}T00:00:00`);
    if (prev !== null && ts - prev === 86_400_000) {
      running += 1;
    } else {
      running = 1;
    }
    longest = Math.max(longest, running);
    prev = ts;
  }

  let current = 0;
  if (activeDays.length > 0) {
    const todayKey = localDateKey(Date.now());
    const yesterdayKey = localDateKey(Date.now() - 86_400_000);
    const last = activeDays[activeDays.length - 1]!;
    if (last === todayKey || last === yesterdayKey) {
      current = 1;
      for (let i = activeDays.length - 2; i >= 0; i--) {
        const a = Date.parse(`${activeDays[i + 1]}T00:00:00`);
        const b = Date.parse(`${activeDays[i]}T00:00:00`);
        if (a - b === 86_400_000) current += 1;
        else break;
      }
    }
  }

  return {
    mostActiveDay,
    mostActiveMonth,
    longestStreakDays: longest,
    currentStreakDays: current,
  };
}

function topKey(m: Map<string, number>): string | null {
  let best: string | null = null;
  let bestN = -1;
  for (const [k, n] of m) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

function toRecentRun(r: RunRecord): RecentRun {
  const primary = r.routes[0];
  const route = primary
    ? `${primary.via ?? primary.provider}${primary.model ? `,${primary.model}` : ''}`
    : '—';
  return {
    id: r.id,
    createdAt: r.createdAt,
    mode: r.mode,
    status: r.status,
    taskType: r.taskType,
    route,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    costUsd: r.costUsd,
    durationMs: r.durationMs,
    rating: r.rating,
    prompt: r.prompt.length > 140 ? `${r.prompt.slice(0, 140)}…` : r.prompt,
  };
}

function localDateKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyReport(cwd: string, dbPath: string, generatedAt: number): UsageReport {
  return {
    project: { cwd, dbPath, hasData: false },
    totals: {
      runs: 0,
      tokensIn: 0,
      tokensOut: 0,
      tokens: 0,
      costUsd: 0,
      monthCostUsd: 0,
      monthKey: localDateKey(generatedAt).slice(0, 7),
      successRate: 0,
      avgDurationMs: 0,
      avgRating: null,
    },
    byMode: [],
    byProvider: [],
    byTaskType: [],
    heatmap: computeHeatmap([], generatedAt),
    highlights: {
      mostActiveMonth: null,
      mostActiveDay: null,
      longestStreakDays: 0,
      currentStreakDays: 0,
    },
    recentRuns: [],
    generatedAt,
  };
}
