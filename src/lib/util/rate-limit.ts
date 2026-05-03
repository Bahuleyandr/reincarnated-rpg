/**
 * Tiny in-process rate limiter. Token-bucket-ish: per-key, the limiter
 * keeps the timestamps of the last N events. A new event is allowed
 * only if the oldest stored timestamp is past the window.
 *
 * Per-process scope. With a multi-instance deploy a player could
 * spread their messages across instances and exceed the rate; for
 * v0.1 with one Next process this is fine. A future Redis-backed
 * version slots in via the same interface.
 *
 * Returns true when allowed, false when limited. Always increments
 * on allow.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

export function checkRate(
  key: string,
  maxHits: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { hits: [] };
    buckets.set(key, b);
  }
  // Drop expired hits.
  const cutoff = now - windowMs;
  b.hits = b.hits.filter((t) => t > cutoff);
  if (b.hits.length >= maxHits) return false;
  b.hits.push(now);
  return true;
}

/** Test-only — flush all buckets. */
export function _flushRateLimitForTests(): void {
  buckets.clear();
}

/** Remaining capacity for a key against the limit. Lets the UI show
 *  "you can say 7 more things this minute" if we want. */
export function rateLimitState(
  key: string,
  maxHits: number,
  windowMs: number,
): { allowed: number; resetMs: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b) return { allowed: maxHits, resetMs: 0 };
  const cutoff = now - windowMs;
  const live = b.hits.filter((t) => t > cutoff);
  const oldest = live[0] ?? now;
  return {
    allowed: Math.max(0, maxHits - live.length),
    resetMs: Math.max(0, oldest + windowMs - now),
  };
}
