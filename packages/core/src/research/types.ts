export type ResearchProviderId = 'tavily' | 'brave' | 'duckduckgo' | 'github' | 'docs';

export type ResearchQuery = {
  query: string;
  /** Optional language filter (github/docs). */
  language?: string;
  /** Optional minimum github stars for github code search. */
  minStars?: number;
  /** Optional max age in months for github / web. */
  maxAgeMonths?: number;
  /** Max results to return. */
  limit?: number;
};

export type ResearchHit = {
  id: string;
  kind: 'web' | 'github' | 'docs';
  title: string;
  url: string;
  source: string;
  snippet?: string;
  language?: string;
  stars?: number;
  /** UTC ISO timestamp. */
  publishedAt?: string;
  raw?: unknown;
};

export type ResearchProvider = {
  id: ResearchProviderId;
  search: (q: ResearchQuery) => Promise<ResearchHit[]>;
};
