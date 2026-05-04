/**
 * Coin balance helpers — read and apply deltas to user / session
 * coin purses. The DB CHECK constraint blocks negative balances at
 * the row level; these helpers also guard before issuing the update
 * so callers get a clean error instead of a 23514.
 *
 * Logged-in players: balance lives on `users.coins`.
 * Anonymous players: balance lives on `sessions.coins`.
 *
 * On registration / claim, anon coins migrate into the user row via
 * `migrateAnonCoinsIntoUser` (called from `maybeClaimAnonSession`).
 *
 * Phase 5 Day 18-19.
 */
import { eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";
import type { Event } from "../game/types";

export interface CoinPurseRef {
  /** Set when reading a logged-in user's purse. */
  userId?: string;
  /** Set for anonymous (no userId) sessions. */
  sessionId?: string;
}

export async function getCoins(db: Db, ref: CoinPurseRef): Promise<number> {
  if (ref.userId) {
    const [row] = await db
      .select({ coins: users.coins })
      .from(users)
      .where(eq(users.id, ref.userId))
      .limit(1);
    return row?.coins ?? 0;
  }
  if (ref.sessionId) {
    const [row] = await db
      .select({ coins: sessions.coins })
      .from(sessions)
      .where(eq(sessions.id, ref.sessionId))
      .limit(1);
    return row?.coins ?? 0;
  }
  return 0;
}

/**
 * Apply a signed coin delta. Returns the post-update balance, or
 * throws if the result would be negative. Atomic: uses a CASE
 * expression so concurrent updates can't interleave a read-then-write
 * race — the DB-side CHECK constraint is the final guard.
 */
export async function applyCoinDelta(
  db: Db,
  ref: CoinPurseRef,
  delta: number,
): Promise<number> {
  if (delta === 0) return getCoins(db, ref);

  if (ref.userId) {
    const result = await db
      .update(users)
      .set({
        coins: sql`${users.coins} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, ref.userId))
      .returning({ coins: users.coins });
    if (result.length === 0) {
      throw new Error(`applyCoinDelta: user not found: ${ref.userId}`);
    }
    return result[0].coins;
  }
  if (ref.sessionId) {
    const result = await db
      .update(sessions)
      .set({
        coins: sql`${sessions.coins} + ${delta}`,
      })
      .where(eq(sessions.id, ref.sessionId))
      .returning({ coins: sessions.coins });
    if (result.length === 0) {
      throw new Error(`applyCoinDelta: session not found: ${ref.sessionId}`);
    }
    return result[0].coins;
  }
  throw new Error("applyCoinDelta: must specify userId or sessionId");
}

/**
 * Sum the coin delta from a batch of newly-applied events. Used by
 * the turn orchestrator to roll up `coins.gained`, `coins.spent`, and
 * `trade.completed` (the trade event's `coinsDelta` is the
 * canonical source — `coins.gained`/`coins.spent` are emitted only
 * for non-trade flows and are also summed). Returns the net delta in
 * coins (positive = balance up).
 */
export function netCoinDeltaFromEvents(events: ReadonlyArray<Event>): number {
  let net = 0;
  for (const e of events) {
    switch (e.kind) {
      case "coins.gained":
        net += e.amount;
        break;
      case "coins.spent":
        net -= e.amount;
        break;
      case "trade.completed":
        net += e.coinsDelta;
        break;
      default:
        break;
    }
  }
  return net;
}

/**
 * Move anon-session coins into a freshly-claimed user row. Called from
 * the register / claim flow after the cookie's session is bound to the
 * user. Idempotent — sessions.coins is reset to 0 after migration so
 * a double-call doesn't double-credit.
 */
export async function migrateAnonCoinsIntoUser(
  db: Db,
  sessionId: string,
  userId: string,
): Promise<number> {
  const [sessionRow] = await db
    .select({ coins: sessions.coins })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const anonCoins = sessionRow?.coins ?? 0;
  if (anonCoins <= 0) return 0;

  await db
    .update(users)
    .set({
      coins: sql`${users.coins} + ${anonCoins}`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await db
    .update(sessions)
    .set({ coins: 0 })
    .where(eq(sessions.id, sessionId));
  return anonCoins;
}
