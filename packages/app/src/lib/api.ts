import type {
  ChatMessageRecord,
  ChatSession,
  LoopEvent,
  LoopIteration,
  LoopRecord,
  LoopSpec,
  LoopValidation,
} from '@coderouter/core';

/**
 * Daemon client. Resolves the loopback daemon URL (from the Electron
 * preload bridge, a Vite env var, or the default port) and provides
 * typed HTTP + SSE helpers. Identical in Electron and a plain browser.
 */

declare global {
  interface Window {
    coderouter?: { getDaemonUrl: () => Promise<string>; isElectron: boolean; platform?: string };
  }
}

/** True on macOS, where the window uses inset traffic lights. */
export const isMac = (): boolean =>
  (window.coderouter?.platform ?? (navigator.platform.toLowerCase().includes('mac') ? 'darwin' : '')) === 'darwin';

const DEFAULT_PORT = 4329;
let basePromise: Promise<string> | null = null;

export function resolveBase(): Promise<string> {
  if (!basePromise) {
    basePromise = (async () => {
      if (window.coderouter?.getDaemonUrl) {
        try {
          return await window.coderouter.getDaemonUrl();
        } catch {
          /* fall through */
        }
      }
      const envUrl = (import.meta as { env?: Record<string, string> }).env?.VITE_DAEMON_URL;
      return envUrl || `http://127.0.0.1:${DEFAULT_PORT}`;
    })();
  }
  return basePromise;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const base = await resolveBase();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
  return json as T;
}

export const api = {
  health: () => req<{ ok: boolean; version: string; pid: number }>('GET', '/api/health'),

  // projects / chats
  projects: () => req<{ projects: ProjectSummary[] }>('GET', '/api/projects'),
  chats: (cwd?: string) => req<{ chats: ChatSummary[] }>('GET', `/api/chats${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  chat: (cwd: string, id: string) =>
    req<{ session: ChatSession; messages: ChatMessageRecord[] }>(
      'GET',
      `/api/chat?cwd=${encodeURIComponent(cwd)}&id=${encodeURIComponent(id)}`,
    ),

  // loops
  loopsAll: () => req<{ loops: Array<LoopRecord & { project: string }> }>('GET', '/api/loops'),
  loops: (cwd: string) => req<{ loops: LoopRecord[] }>('GET', `/api/loops?cwd=${encodeURIComponent(cwd)}`),
  loop: (cwd: string, id: string) => req<LoopRecord>('GET', `/api/loops/${id}?cwd=${encodeURIComponent(cwd)}`),
  iterations: (cwd: string, id: string) =>
    req<{ iterations: LoopIteration[] }>('GET', `/api/loops/${id}/iterations?cwd=${encodeURIComponent(cwd)}`),
  presets: () => req<{ presets: PresetInfo[] }>('GET', '/api/loops/presets'),
  discover: (cwd: string) =>
    req<{ ecosystem: string; packageManager: string | null; commands: DiscoveredCommand[] }>(
      'GET',
      `/api/loops/discover?cwd=${encodeURIComponent(cwd)}`,
    ),
  generate: (cwd: string, request: string, preset: string, verifierCommands?: string[]) =>
    req<{ spec: LoopSpec; discovered: unknown; generated: boolean; validation: LoopValidation }>(
      'POST',
      '/api/loops/generate',
      { cwd, request, preset, verifierCommands },
    ),
  createLoop: (cwd: string, request: string, preset: string) =>
    req<{ record: LoopRecord; validation: LoopValidation; generated: boolean }>('POST', '/api/loops', {
      cwd,
      request,
      preset,
    }),
  createFromSpec: (cwd: string, spec: LoopSpec) =>
    req<{ record: LoopRecord; validation: LoopValidation }>('POST', '/api/loops/from-spec', { cwd, spec }),
  updateSpec: (cwd: string, id: string, spec: LoopSpec) =>
    req<LoopRecord>('PUT', `/api/loops/${id}/spec`, { cwd, spec }),
  startLoop: (cwd: string, id: string) => req<{ ok: boolean }>('POST', `/api/loops/${id}/start`, { cwd }),
  pauseLoop: (cwd: string, id: string) => req<{ ok: boolean }>('POST', `/api/loops/${id}/pause`, { cwd }),
  resumeLoop: (cwd: string, id: string) => req<{ ok: boolean }>('POST', `/api/loops/${id}/resume`, { cwd }),
  stopLoop: (cwd: string, id: string) => req<{ ok: boolean }>('POST', `/api/loops/${id}/stop`, { cwd }),
  approveLoop: (cwd: string, id: string) => req<{ applied: boolean; error?: string }>('POST', `/api/loops/${id}/approve`, { cwd }),
  rejectLoop: (cwd: string, id: string) => req<{ ok: boolean }>('POST', `/api/loops/${id}/reject`, { cwd }),
  deleteLoop: (cwd: string, id: string) => req<{ ok: boolean }>('DELETE', `/api/loops/${id}?cwd=${encodeURIComponent(cwd)}`),

  // migrated dashboard data
  usage: () => req<UsageReport>('GET', '/api/usage'),
  settings: () => req<SettingsReport>('GET', '/api/settings'),
  assets: (cwd?: string) => req<AssetsReport>('GET', `/api/assets${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  plugins: (cwd?: string) => req<PluginsReport>('GET', `/api/plugins${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),

  // plugin install / marketplace
  refreshPlugins: (cwd?: string) => req<PluginsReport>('POST', '/api/plugins/refresh', { cwd }),
  installPlugin: (id: string, opts: { cwd?: string; marketplace?: string; scope: 'project' | 'global' }) =>
    req<{ ok: boolean; installed: unknown; skipped?: string[] }>('POST', '/api/plugins/install', { id, ...opts }),
  uninstallPlugin: (id: string, opts: { cwd?: string; scope: 'project' | 'global' }) =>
    req<{ ok: boolean; removed: boolean }>('POST', '/api/plugins/uninstall', { id, ...opts }),
  addMarketplace: (repo: string, name?: string) => req('POST', '/api/plugins/marketplace', { repo, name }),
  removeMarketplace: (name: string) => req('DELETE', '/api/plugins/marketplace', { name }),

  // rules / skills / subagents
  createRule: (body: { cwd?: string; scope: 'project' | 'global'; id: string; description?: string; globs?: string[]; alwaysApply?: boolean; body: string }) =>
    req('POST', '/api/assets/rule', body),
  deleteRule: (cwd: string | undefined, scope: 'project' | 'global', id: string) => req('DELETE', '/api/assets/rule', { cwd, scope, id }),
  createSkill: (body: { cwd?: string; scope: 'project' | 'global'; name: string; description?: string; body: string }) =>
    req('POST', '/api/assets/skill', body),
  deleteSkill: (cwd: string | undefined, scope: 'project' | 'global', slug: string) => req('DELETE', '/api/assets/skill', { cwd, scope, slug }),
  createSubagent: (body: { cwd?: string; scope: 'project' | 'global'; name: string; description?: string; kind?: string; provider?: string; model?: string; effort?: string; body: string }) =>
    req('POST', '/api/assets/subagent', body),
  deleteSubagent: (cwd: string | undefined, scope: 'project' | 'global', slug: string) => req('DELETE', '/api/assets/subagent', { cwd, scope, slug }),

  saveKey: (name: string, apiKey: string) => req('POST', '/api/settings/key', { name, apiKey }),
  setHost: (provider: string, enabled: boolean) => req('POST', '/api/settings/host', { provider, enabled }),
  setLimit: (monthlyUsd: number | null) => req('POST', '/api/settings/limit', { monthlyUsd }),
  setPreferred: (tier: string, provider: string | null, model: string | null) =>
    req('POST', '/api/settings/preferred-model', { tier, provider, model }),
};

export type ChatStreamEvent =
  | { type: 'start'; sessionId: string }
  | { type: 'chunk'; text: string }
  | {
      type: 'done';
      sessionId: string;
      text: string;
      runId: string;
      route: string | null;
      costUsd: number;
      tokensIn: number;
      tokensOut: number;
      diff: string | null;
    }
  | { type: 'error'; error: string };

/**
 * Run one chat turn, streaming the answer. POSTs to the daemon and reads
 * the text/event-stream body, parsing `data:` frames into typed events.
 */
export async function sendChat(
  body: { cwd: string; sessionId: string; prompt: string; mode?: string; effort?: string },
  onEvent: (e: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const base = await resolveBase();
  const res = await fetch(`${base}/api/chat/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      try {
        onEvent(JSON.parse(json) as ChatStreamEvent);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

/** Subscribe to live loop events over SSE. Returns an unsubscribe fn. */
export async function subscribeLoopEvents(onEvent: (e: LoopEvent | { type: 'hello' }) => void): Promise<() => void> {
  const base = await resolveBase();
  const es = new EventSource(`${base}/api/loops/events`);
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      /* ignore */
    }
  };
  return () => es.close();
}

// ---- view types (mirror the daemon JSON) ---------------------------

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
export type ChatSummary = ChatSession & { project: string };
export type PresetInfo = { id: string; label: string; description: string; limits: { maxIterations: number; maxCostUsd: number; maxFilesChanged: number } };
export type DiscoveredCommand = { kind: string; command: string; source: string };

export type Breakdown = { key: string; label: string; runs: number; tokens: number; costUsd: number };
export type HeatmapDay = { date: string; runs: number; tokens: number };
export type RecentRun = {
  id: string;
  createdAt: number;
  mode: string;
  status: string;
  route: string;
  costUsd: number;
  durationMs: number;
  prompt: string;
};
export type UsageReport = {
  project: { cwd: string; dbPath: string; hasData: boolean; projectCount: number };
  totals: {
    runs: number;
    tokensIn: number;
    tokensOut: number;
    tokens: number;
    costUsd: number;
    monthCostUsd: number;
    monthKey: string;
    successRate: number;
    avgDurationMs: number;
  };
  byMode: Breakdown[];
  byProvider: Breakdown[];
  byTaskType: Breakdown[];
  heatmap: HeatmapDay[];
  highlights: { mostActiveMonth: string | null; mostActiveDay: string | null; longestStreakDays: number; currentStreakDays: number };
  recentRuns: RecentRun[];
};
export type ProviderSetting = { name: string; label: string; envVar: string; configured: boolean; source?: string };
export type HostSetting = { provider: string; label: string; cli: string; binPath: string; blurb: string; enabled: boolean };
export type AvailableModel = { provider: string; model: string; label: string; tiers: string[] };
export type SettingsReport = {
  providers: ProviderSetting[];
  searchProviders: ProviderSetting[];
  hosts: HostSetting[];
  limits: { monthlyUsd: number | null };
  preferredModels: { strong: { provider: string; model: string } | null; cheap: { provider: string; model: string } | null };
  availableModels: AvailableModel[];
  paths: { credentials: string; db: string };
};
export type RuleAsset = { id: string; scope: string; path: string; description: string; globs: string[]; alwaysApply: boolean; body: string };
export type SkillAsset = { slug: string; scope: string; path: string; name: string; description: string; body: string };
export type SubagentAsset = {
  slug: string;
  scope: string;
  path: string;
  name: string;
  description: string;
  kind?: string;
  provider?: string;
  model?: string;
  effort?: string;
  body: string;
};
export type AssetsReport = {
  rules: RuleAsset[];
  skills: SkillAsset[];
  subagents: SubagentAsset[];
  roots: { project: string; global: string };
};
export type PluginItem = {
  id: string;
  name: string;
  description: string;
  author?: string;
  category?: string;
  tags?: string[];
  marketplace?: string;
  installedProject: boolean;
  installedGlobal: boolean;
};
export type PluginsReport = {
  catalog: PluginItem[];
  marketplaces: Array<{ name: string; repo: string; source: string; count: number; error?: string }>;
  categories: string[];
  orphans: PluginItem[];
};
