/**
 * Tiny retry helper for upstream API calls.
 *
 * Rules:
 *   - Max 1 retry by default (so 2 total attempts).
 *   - Only retries on transient signals: HTTP 408/425/429/500/502/503/504,
 *     network errors (ECONNRESET, ETIMEDOUT, EAI_AGAIN, ENOTFOUND),
 *     fetch's "TypeError: fetch failed".
 *   - Backoff: 250ms baseline + up to 250ms random jitter. We don't
 *     ramp aggressively because the LLM call sits inside the player's
 *     turn budget — one quick retry is enough to absorb most flakes
 *     without blowing past the 10-15s perceived-latency ceiling.
 *
 * Provider implementations can opt in by wrapping their `fetch` /
 * `client.messages.create` call with `withRetry()`.
 */
export interface RetryOpts {
  maxRetries?: number;
  baseDelayMs?: number;
  jitterMs?: number;
  /** Override of the "is retryable" predicate. Used by tests. */
  isRetryable?: (err: unknown) => boolean;
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_NET_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "ECONNABORTED",
]);

export function isRetryableError(err: unknown): boolean {
  if (!err) return false;
  // HTTP-shaped errors: most SDKs expose `.status` or `.statusCode`.
  const e = err as { status?: number; statusCode?: number; code?: string };
  if (typeof e.status === "number" && RETRYABLE_STATUSES.has(e.status))
    return true;
  if (typeof e.statusCode === "number" && RETRYABLE_STATUSES.has(e.statusCode))
    return true;
  if (typeof e.code === "string" && RETRYABLE_NET_CODES.has(e.code))
    return true;
  // fetch's bare network failure — TypeError("fetch failed").
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return true;
  // Our OpenAI-compatible provider throws Error("OpenAI-compatible API
  // <code>: ..."). Parse the code out of the message.
  if (err instanceof Error) {
    const m = /OpenAI-compatible API (\d+):/i.exec(err.message);
    if (m && RETRYABLE_STATUSES.has(Number(m[1]))) return true;
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 1;
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const jitterMs = opts.jitterMs ?? 250;
  const retryable = opts.isRetryable ?? isRetryableError;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries || !retryable(err)) throw err;
      const delay = baseDelayMs + Math.floor(Math.random() * jitterMs);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}
