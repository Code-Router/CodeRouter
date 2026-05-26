import { httpJson } from '../../adapters/http.js';
import { exec } from '../../sandbox/exec.js';
import type { ResearchHit, ResearchProvider, ResearchQuery } from '../types.js';

export type GitHubOptions = {
  token?: string;
  tokenEnv?: string;
  endpoint?: string;
  timeoutMs?: number;
};

/**
 * GitHub code search.
 *
 * Prefers `gh search code` (uses the user's gh auth, fastest path); if
 * gh isn't on PATH, falls back to the GitHub REST API with GH_TOKEN.
 * Filters: language, minStars, maxAgeMonths.
 */
export class GitHubProvider implements ResearchProvider {
  id = 'github' as const;
  constructor(public readonly opts: GitHubOptions = {}) {}

  async search(q: ResearchQuery): Promise<ResearchHit[]> {
    const gh = await this.searchViaGh(q).catch(() => null);
    if (gh && gh.length > 0) return gh;
    return this.searchViaRest(q);
  }

  private async searchViaGh(q: ResearchQuery): Promise<ResearchHit[] | null> {
    const queryParts = [q.query];
    if (q.language) queryParts.push(`language:${q.language}`);
    if (q.minStars) queryParts.push(`stars:>=${q.minStars}`);
    const args = [
      'search',
      'code',
      ...queryParts,
      '--json',
      'path,repository,sha,url',
      '--limit',
      String(q.limit ?? 8),
    ];
    const r = await exec('gh', args, { timeoutMs: this.opts.timeoutMs ?? 12_000 });
    if (r.exitCode !== 0) return null;
    const parsed = JSON.parse(r.stdout || '[]') as {
      path?: string;
      url?: string;
      sha?: string;
      repository?: { nameWithOwner?: string };
    }[];
    return parsed.map((p, i) => ({
      id: `gh-${i}`,
      kind: 'github' as const,
      title: `${p.repository?.nameWithOwner ?? 'unknown'} - ${p.path ?? ''}`,
      url: p.url ?? '',
      source: 'github',
      language: q.language,
    }));
  }

  private async searchViaRest(q: ResearchQuery): Promise<ResearchHit[]> {
    const token = this.opts.token ?? process.env[this.opts.tokenEnv ?? 'GH_TOKEN'] ?? process.env.GITHUB_TOKEN;
    if (!token) return [];
    const queryParts = [q.query];
    if (q.language) queryParts.push(`language:${q.language}`);
    if (q.minStars) queryParts.push(`stars:>=${q.minStars}`);
    const url = new URL(this.opts.endpoint ?? 'https://api.github.com/search/code');
    url.searchParams.set('q', queryParts.join(' '));
    url.searchParams.set('per_page', String(q.limit ?? 8));
    const res = await httpJson<{
      items?: {
        path?: string;
        html_url?: string;
        repository?: { full_name?: string; stargazers_count?: number };
      }[];
    }>({
      url: url.toString(),
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
      },
      timeoutMs: this.opts.timeoutMs ?? 12_000,
    }).catch(() => ({ items: [] }));
    return (res.items ?? []).map((it, i) => ({
      id: `gh-rest-${i}`,
      kind: 'github' as const,
      title: `${it.repository?.full_name ?? 'unknown'} - ${it.path ?? ''}`,
      url: it.html_url ?? '',
      source: 'github',
      stars: it.repository?.stargazers_count,
      language: q.language,
    }));
  }
}
