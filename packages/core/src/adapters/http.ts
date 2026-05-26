export type HttpJsonInit = {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * Thin fetch wrapper used by adapters and research providers.
 *
 * Adds timeouts, JSON encode/decode, and a useful error message that
 * includes the upstream response body (so providers like OpenRouter and
 * DeepSeek give us actionable failures instead of just 4xx).
 */
export async function httpJson<T = unknown>(init: HttpJsonInit): Promise<T> {
  const ctl = new AbortController();
  const ext = init.signal;
  if (ext) ext.addEventListener('abort', () => ctl.abort());
  const timeout = init.timeoutMs
    ? setTimeout(() => ctl.abort(new Error('http timeout')), init.timeoutMs)
    : null;

  try {
    const res = await fetch(init.url, {
      method: init.method,
      headers: init.headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(
        `HTTP ${res.status} ${res.statusText} from ${init.url}: ${text.slice(0, 500)}`,
        res.status,
        text,
      );
    }
    return (await res.json()) as T;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
