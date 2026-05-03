/**
 * Tiny in-memory TTL cache for public reads.
 *
 * Used by /api/meta, /api/lore, /api/leaderboard — endpoints whose
 * payloads change slowly (every minute or two as players end runs)
 * but get hit by every active /play page polling them. With ~100
 * concurrent players, a 60s TTL drops 99% of those round-trips off
 * the database.
 *
 * Per-request scope: the cache lives on the Next.js process, which
 * is a fine match for our deployment shape (single Next process or
 * a few behind a load balancer; cache misses are cheap). Not
 * appropriate for things that need exactness (e.g. cost panel —
 * that's per-user and live).
 *
 * The cache is keyed by a string the caller composes; no automatic
 * key derivation. Caller is responsible for making the key reflect
 * the inputs (e.g. `meta:30d:narrator` for a 30-day narrator
 * leaderboard slice).
 */

interface Entry<T> {
  expiresAt: number;
  value: T;
}

const store = new Map<string, Entry<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const e = store.get(key);
  if (e && e.expiresAt > now) {
    return e.value as T;
  }
  const value = await fetcher();
  store.set(key, { expiresAt: now + ttlMs, value });
  return value;
}

/** Forcibly drop a key — useful when a write path knows it just
 *  invalidated the cached read. */
export function invalidate(key: string): void {
  store.delete(key);
}

/** Drop everything matching a prefix. */
export function invalidatePrefix(prefix: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

/** Test-only — flush everything. */
export function _flushCacheForTests(): void {
  store.clear();
}
