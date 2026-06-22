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

// --------------- SSE streaming reader ---------------

export type HttpStreamInit = HttpJsonInit & {
  /**
   * Idle timeout: how many ms the reader can go without receiving a
   * new SSE event before aborting. Resets on every chunk, so slow
   * generations stay alive. Default 90s.
   */
  idleTimeoutMs?: number;
};

/**
 * POST with `stream: true` semantics. Reads the response body as an
 * SSE stream and calls `onEvent` for every parsed JSON payload.
 *
 * Handles:
 * - `data: [DONE]` (terminates cleanly)
 * - multi-line buffering (events split on `\n\n`)
 * - idle timeout (resets per event, defaults to 90s)
 * - AbortSignal propagation
 */
export async function httpStream(
  init: HttpStreamInit,
  onEvent: (json: unknown) => void,
): Promise<void> {
  const DEFAULT_IDLE_MS = 90_000;
  const ctl = new AbortController();
  const ext = init.signal;
  if (ext) ext.addEventListener('abort', () => ctl.abort());

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const idleMs = init.idleTimeoutMs ?? DEFAULT_IDLE_MS;

  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ctl.abort(new Error('stream idle timeout')), idleMs);
  }

  resetIdle();

  try {
    const res = await fetch(init.url, {
      method: init.method,
      headers: { ...init.headers, Accept: 'text/event-stream' },
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

    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      buf += decoder.decode(value, { stream: true });

      // SSE events are separated by double newlines.
      let boundary: number;
      while ((boundary = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, boundary);
        buf = buf.slice(boundary + 2);

        for (const line of raw.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') return;
          try {
            onEvent(JSON.parse(payload));
          } catch {
            // Malformed JSON line - skip.
          }
        }
      }
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}
