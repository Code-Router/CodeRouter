import { encode as encodeTokens } from 'gpt-tokenizer';
import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { exec } from '../sandbox/exec.js';
import { whichSync } from '../sandbox/which.js';
import type { ContextManifest, ContextManifestEntry } from '../types.js';
import { isSecretPath } from './secrets.js';

export type ScanOptions = {
  cwd: string;
  prompt: string;
  /** Hard cap on the total token budget of the manifest. */
  budget?: number;
  /** Maximum files to keep. */
  maxFiles?: number;
  /** Skip git history boost (faster, but worse for hot files). */
  skipGit?: boolean;
  /** Adapter family: shell adapters get manifest-only output; API adapters get contents up to budget. */
  family?: 'shell-agent' | 'api-model';
};

const DEFAULT_BUDGET = 30_000;
const DEFAULT_MAX_FILES = 40;
const FILE_TOKEN_ESTIMATE_CHARS = 4;

const NOUN_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'it', 'this', 'that', 'in', 'on', 'at',
  'to', 'of', 'for', 'with', 'from', 'by', 'as', 'be', 'are', 'was', 'were', 'i', 'we',
  'you', 'they', 'add', 'fix', 'update', 'change', 'make', 'do', 'please', 'help',
  'show', 'tell', 'find', 'check', 'review', 'use', 'using',
]);

/** Extracts meaningful nouns from the prompt for ripgrep keyword search. */
export function promptNouns(prompt: string, k = 6): string[] {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !NOUN_STOPWORDS.has(w));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= k) break;
  }
  return out;
}

/**
 * Repo context scanner.
 *
 * Strategy:
 *   1) Run `git diff --name-only HEAD` and recent activity for a hot-file boost.
 *   2) Run `rg --files-with-matches -i <prompt-noun>` per extracted noun.
 *   3) Score each candidate file by (ripgrep matches + git activity + manifest weight).
 *   4) Skip secrets via the deny-list before reading sizes/contents.
 *   5) Pack the top-K into a token budget; truncate and mark the manifest.
 */
export async function scanContext(opts: ScanOptions): Promise<ContextManifest> {
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;

  const nouns = promptNouns(opts.prompt);
  const matches = await Promise.all(nouns.map((n) => ripgrep(n, opts.cwd)));
  const hotFiles = opts.skipGit ? new Set<string>() : await recentlyChangedFiles(opts.cwd);

  const score = new Map<string, { matches: number; nounMatches: Set<string> }>();
  for (let i = 0; i < nouns.length; i += 1) {
    const noun = nouns[i];
    if (noun === undefined) continue;
    for (const file of matches[i] ?? []) {
      if (isSecretPath(file)) continue;
      const cur = score.get(file) ?? { matches: 0, nounMatches: new Set<string>() };
      cur.matches += 1;
      cur.nounMatches.add(noun);
      score.set(file, cur);
    }
  }
  for (const file of hotFiles) {
    if (isSecretPath(file)) continue;
    const cur = score.get(file) ?? { matches: 0, nounMatches: new Set<string>() };
    cur.matches += 0.5;
    cur.nounMatches.add('recent-activity');
    score.set(file, cur);
  }

  const candidates = await Promise.all(
    [...score.entries()].map(async ([path, info]) => {
      const abs = isAbsolute(path) ? path : resolve(opts.cwd, path);
      let size = 0;
      try {
        size = (await stat(abs)).size;
      } catch {
        size = 0;
      }
      const tokenEstimate = Math.max(1, Math.ceil(size / FILE_TOKEN_ESTIMATE_CHARS));
      return {
        path: abs,
        info,
        tokenEstimate,
      };
    }),
  );

  const ranked = candidates
    .sort((a, b) => {
      const aScore = a.info.matches + a.info.nounMatches.size * 0.3;
      const bScore = b.info.matches + b.info.nounMatches.size * 0.3;
      return bScore - aScore;
    })
    .slice(0, maxFiles);

  let used = 0;
  const entries: ContextManifestEntry[] = [];
  let truncated = false;

  for (const cand of ranked) {
    const rel = relative(opts.cwd, cand.path);
    if (used + cand.tokenEstimate > budget) {
      truncated = true;
      continue;
    }
    used += cand.tokenEstimate;
    entries.push({
      path: rel || cand.path,
      reason: [...cand.info.nounMatches].join(', '),
      importance: Math.min(
        1,
        cand.info.matches / (nouns.length || 1) + cand.info.nounMatches.size * 0.1,
      ),
      tokenEstimate: cand.tokenEstimate,
    });
  }

  return {
    entries,
    totalTokens: used,
    budget,
    truncated,
  };
}

/**
 * Re-estimate token cost using the actual gpt tokenizer; used when we
 * have to deliver file contents (api-adapter family) and need to be
 * exact about budget consumption.
 */
export function tokensFor(text: string): number {
  try {
    return encodeTokens(text).length;
  } catch {
    return Math.ceil(text.length / FILE_TOKEN_ESTIMATE_CHARS);
  }
}

/**
 * Whether a standalone `rg` binary is on PATH. Memoised: PATH doesn't
 * change within a process, and we'd otherwise re-resolve it once per
 * prompt noun. `null` = not yet checked.
 */
let rgAvailable: boolean | null = null;

async function ripgrep(pattern: string, cwd: string): Promise<string[]> {
  // The L1 ripgrep boost is a best-effort relevance signal, not a hard
  // requirement - the scan still works (just less precisely) without
  // it. Guard on `whichSync` like `agent/tools/grep.ts` does so a
  // machine without a standalone ripgrep doesn't crash the whole run
  // with `spawn rg ENOENT`.
  if (rgAvailable === null) rgAvailable = whichSync('rg') !== null;
  if (!rgAvailable) return [];
  try {
    const r = await exec(
      'rg',
      ['--files-with-matches', '-i', '--hidden', '--glob', '!.git', '-S', pattern, '.'],
      { cwd, timeoutMs: 5_000 },
    );
    if (r.exitCode !== 0 && r.exitCode !== 1) return [];
    return r.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    // ENOENT (rg vanished mid-process) or spawn failure - degrade
    // gracefully rather than aborting the agent run.
    return [];
  }
}

async function recentlyChangedFiles(cwd: string): Promise<Set<string>> {
  const res = await exec('git', ['log', '--name-only', '--pretty=format:', '-n', '50'], {
    cwd,
    timeoutMs: 5_000,
  });
  if (res.exitCode !== 0) return new Set();
  const out = new Set<string>();
  for (const line of res.stdout.split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('commit ')) out.add(t);
  }
  return out;
}
