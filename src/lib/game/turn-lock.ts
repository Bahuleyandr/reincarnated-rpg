/**
 * Per-session turn-lock primitive (see ADR-020).
 *
 * Each `/api/turn` (and `/api/turn/stream`) request acquires a lock
 * before doing any work, and releases it in a finally block. The
 * lock is a token + expiry pair on the `sessions` row, claimed
 * atomically via a guarded UPDATE. Concurrent POSTs for the same
 * session see the lock and 409.
 *
 * Every state change writes a row into `turn_lock_events` so we have
 * a forensic trail: when locks were acquired, when they were
 * released, when an expired lock was implicitly reclaimed by a new
 * acquire, and when an admin force-released a stuck lock. The audit
 * trail is bounded — ~2 rows per turn (acquire + release) — so it
 * scales linearly with turn volume.
 *
 * Default TTL is 90 seconds: long enough for the typical 5-30s
 * narrator + tools turn (including LLM retries on tool validation),
 * short enough that an orphaned lock self-heals within a couple of
 * minutes when the next acquire reclaims it.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";

import type { Db } from "../db/client";
import { sessions, turnLockEvents } from "../db/schema";
import { log } from "../util/log";

export interface TurnLock {
  sessionId: string;
  token: string;
  expiresAt: Date;
  /** True if this acquire reclaimed an expired lock (the previous
   *  holder timed out). Logged to the audit table; useful for
   *  metrics ("how often do turns time out"). */
  reclaimedExpired: boolean;
}

/**
 * Try to claim the per-session turn lock. Returns null if a live lock
 * is already held by another caller; otherwise returns the new lock.
 *
 * The acquire is atomic: a single UPDATE guarded by `(token IS NULL
 * OR expires_at < now())`. If a row was updated, we own the lock.
 *
 * Auditing: writes one row per call. `acquired` if the lock was free.
 * `claimed_expired` if we reclaimed a stale lock (the prior holder
 * timed out). No audit row when we *fail* to acquire (the failed
 * attempt is implicit in the existing winner's row).
 */
export async function acquireTurnLock(
  db: Db,
  sessionId: string,
  ttlMs = 90_000,
): Promise<TurnLock | null> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs);

  // Capture the prior expiry (if any) so we can tell whether we
  // claimed an expired lock vs a free one — interesting for audit.
  const priorRows = await db
    .select({ expiresAt: sessions.turnLockExpiresAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const priorExpiry = priorRows[0]?.expiresAt ?? null;

  // postgres-js doesn't auto-serialize Date in a tagged-template
  // literal — pass the ISO string and let Postgres parse the
  // timestamptz. Drizzle's typed query builder would handle the
  // Date for us, but we want the atomic guarded UPDATE which is
  // most legible as raw SQL.
  const expiresAtIso = expiresAt.toISOString();
  const rows = (await db.$client`
    UPDATE sessions
       SET turn_lock_token = ${token},
           turn_lock_expires_at = ${expiresAtIso}::timestamptz
     WHERE id = ${sessionId}
       AND (
         turn_lock_expires_at IS NULL
         OR turn_lock_expires_at < now()
       )
     RETURNING id
  `) as Array<{ id: string }>;

  if (rows.length === 0) return null;

  const reclaimedExpired =
    priorExpiry !== null && priorExpiry.getTime() < Date.now();

  await writeAudit(db, sessionId, reclaimedExpired ? "claimed_expired" : "acquired", token, {
    ttlMs,
    priorExpiry: priorExpiry?.toISOString() ?? null,
  });

  return { sessionId, token, expiresAt, reclaimedExpired };
}

/**
 * Release a held lock. The token must match — protects against
 * stale-process scenarios where a delayed worker tries to release a
 * lock that has since been reclaimed by a different process.
 *
 * Returns true if we actually released our lock; false if the lock
 * was already gone (token mismatch — likely stolen by an expiry
 * claim). Either way the audit table records the outcome.
 */
export async function releaseTurnLock(
  db: Db,
  lock: TurnLock | null,
): Promise<boolean> {
  if (!lock) return false;
  const rows = (await db.$client`
    UPDATE sessions
       SET turn_lock_token = NULL,
           turn_lock_expires_at = NULL
     WHERE id = ${lock.sessionId}
       AND turn_lock_token = ${lock.token}
     RETURNING id
  `) as Array<{ id: string }>;
  const released = rows.length > 0;
  await writeAudit(
    db,
    lock.sessionId,
    released ? "released" : "release_no_op",
    lock.token,
    {
      heldMs: Date.now() - (lock.expiresAt.getTime() - 90_000),
    },
  );
  if (!released) {
    log.warn("turn-lock.release_no_op", {
      sessionId: lock.sessionId,
      token: lock.token,
    });
  }
  return released;
}

/**
 * Admin force-release: clear the lock regardless of token. Used by
 * /god/locks when a session is stuck. Always emits a
 * `force_released` audit row with the actor's user id (if known) in
 * metadata so the action is attributable.
 */
export async function forceReleaseTurnLock(
  db: Db,
  sessionId: string,
  actorUserId: string | null = null,
  reason: string | null = null,
): Promise<boolean> {
  const rows = (await db.$client`
    UPDATE sessions
       SET turn_lock_token = NULL,
           turn_lock_expires_at = NULL
     WHERE id = ${sessionId}
       AND turn_lock_token IS NOT NULL
     RETURNING id
  `) as Array<{ id: string }>;
  const released = rows.length > 0;
  if (released) {
    await writeAudit(db, sessionId, "force_released", null, {
      actorUserId,
      reason,
    });
    log.info("turn-lock.force_released", { sessionId, actorUserId, reason });
  }
  return released;
}

/**
 * List currently-held locks (admin view). Includes age — useful for
 * spotting locks that are about to expire vs. ones that just landed.
 */
export interface ActiveLock {
  sessionId: string;
  token: string;
  expiresAt: Date;
  ageMs: number;
}

export async function getActiveLocks(db: Db): Promise<ActiveLock[]> {
  const now = Date.now();
  const rows = await db
    .select({
      id: sessions.id,
      token: sessions.turnLockToken,
      expiresAt: sessions.turnLockExpiresAt,
    })
    .from(sessions)
    .where(
      and(
        isNotNull(sessions.turnLockToken),
        gt(sessions.turnLockExpiresAt, new Date(now)),
      ),
    )
    .orderBy(desc(sessions.turnLockExpiresAt));

  return rows
    .filter((r): r is { id: string; token: string; expiresAt: Date } =>
      r.token !== null && r.expiresAt !== null,
    )
    .map((r) => ({
      sessionId: r.id,
      token: r.token,
      expiresAt: r.expiresAt,
      ageMs: now - (r.expiresAt.getTime() - 90_000),
    }));
}

/**
 * Recent audit-log entries for a single session. Powers the per-
 * session detail view in /god/locks.
 */
export async function getLockHistory(
  db: Db,
  sessionId: string,
  limit = 20,
) {
  return db
    .select()
    .from(turnLockEvents)
    .where(eq(turnLockEvents.sessionId, sessionId))
    .orderBy(desc(turnLockEvents.at))
    .limit(limit);
}

async function writeAudit(
  db: Db,
  sessionId: string,
  eventKind: string,
  token: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(turnLockEvents).values({
      sessionId,
      eventKind,
      token,
      metadata: metadata as never,
    });
  } catch (err) {
    // Audit must NEVER break the lock primitive. If the insert fails
    // (e.g. session was deleted mid-turn, table missing during a
    // half-applied migration), log and move on.
    log.warn("turn-lock.audit.insert_failed", {
      sessionId,
      eventKind,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
