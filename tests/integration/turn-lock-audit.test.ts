/**
 * Audit + admin force-release semantics for the turn-lock primitive.
 *
 * The basic acquire/release happy path is exercised in turn.test.ts;
 * this suite focuses on:
 *   - audit rows written for every state change
 *   - claimed_expired vs acquired distinction
 *   - release_no_op when the token doesn't match
 *   - force-release writes a force_released audit row + clears the lock
 *   - getActiveLocks excludes expired entries
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { desc, eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { sessions, turnLockEvents } from "@/lib/db/schema";
import {
  acquireTurnLock,
  forceReleaseTurnLock,
  getActiveLocks,
  releaseTurnLock,
} from "@/lib/game/turn-lock";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let sessionId: string;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  client = postgres(url, { max: 1, onnotice: () => {} });
  db = drizzle(client) as unknown as Db;
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.unsafe(
    "TRUNCATE turn_lock_events, sessions RESTART IDENTITY CASCADE",
  );
  sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `t-${sessionId}`,
    formId: "lesser-slime",
  });
});

async function recentEventKinds(sid: string): Promise<string[]> {
  const rows = await db
    .select({ kind: turnLockEvents.eventKind })
    .from(turnLockEvents)
    .where(eq(turnLockEvents.sessionId, sid))
    .orderBy(desc(turnLockEvents.at));
  return rows.map((r) => r.kind);
}

describe("turn-lock audit", () => {
  test("acquire on a free session writes 'acquired'", async () => {
    const lock = await acquireTurnLock(db, sessionId);
    expect(lock).not.toBeNull();
    expect(lock!.reclaimedExpired).toBe(false);
    const kinds = await recentEventKinds(sessionId);
    expect(kinds).toEqual(["acquired"]);
  });

  test("happy-path release writes 'released'", async () => {
    const lock = await acquireTurnLock(db, sessionId);
    const released = await releaseTurnLock(db, lock);
    expect(released).toBe(true);
    const kinds = await recentEventKinds(sessionId);
    expect(kinds).toEqual(["released", "acquired"]);
  });

  test("acquire over an expired lock writes 'claimed_expired'", async () => {
    // Plant an expired lock manually.
    await db
      .update(sessions)
      .set({
        turnLockToken: "stale-token",
        turnLockExpiresAt: new Date(Date.now() - 1000),
      })
      .where(eq(sessions.id, sessionId));

    const lock = await acquireTurnLock(db, sessionId);
    expect(lock).not.toBeNull();
    expect(lock!.reclaimedExpired).toBe(true);
    const kinds = await recentEventKinds(sessionId);
    expect(kinds).toEqual(["claimed_expired"]);
  });

  test("acquire fails when a live lock is held; no audit row on the failure", async () => {
    const first = await acquireTurnLock(db, sessionId);
    expect(first).not.toBeNull();
    const second = await acquireTurnLock(db, sessionId);
    expect(second).toBeNull();
    const kinds = await recentEventKinds(sessionId);
    expect(kinds).toEqual(["acquired"]); // only the winning acquire
  });

  test("release with a stale token writes 'release_no_op'", async () => {
    const lock = await acquireTurnLock(db, sessionId);
    // Simulate a different worker having taken over by force-clearing.
    await db
      .update(sessions)
      .set({ turnLockToken: null, turnLockExpiresAt: null })
      .where(eq(sessions.id, sessionId));

    const released = await releaseTurnLock(db, lock);
    expect(released).toBe(false);
    const kinds = await recentEventKinds(sessionId);
    // 'release_no_op' is the most recent event after 'acquired'.
    expect(kinds[0]).toBe("release_no_op");
  });

  test("releaseTurnLock(null) is a safe no-op (no audit row)", async () => {
    const released = await releaseTurnLock(db, null);
    expect(released).toBe(false);
    const kinds = await recentEventKinds(sessionId);
    expect(kinds).toEqual([]);
  });
});

describe("forceReleaseTurnLock", () => {
  test("clears a stuck lock and writes 'force_released' with actor", async () => {
    const lock = await acquireTurnLock(db, sessionId);
    expect(lock).not.toBeNull();
    const fakeAdmin = uuidv7();
    const released = await forceReleaseTurnLock(
      db,
      sessionId,
      fakeAdmin,
      "test cleanup",
    );
    expect(released).toBe(true);
    const rows = await db
      .select()
      .from(turnLockEvents)
      .where(eq(turnLockEvents.sessionId, sessionId))
      .orderBy(desc(turnLockEvents.at))
      .limit(1);
    expect(rows[0].eventKind).toBe("force_released");
    expect(rows[0].metadata).toMatchObject({
      actorUserId: fakeAdmin,
      reason: "test cleanup",
    });
    // Lock is cleared on the row.
    const fresh = await db
      .select({
        token: sessions.turnLockToken,
        expiresAt: sessions.turnLockExpiresAt,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    expect(fresh[0].token).toBeNull();
    expect(fresh[0].expiresAt).toBeNull();
  });

  test("force-release on an unlocked session is a no-op", async () => {
    const released = await forceReleaseTurnLock(db, sessionId, null);
    expect(released).toBe(false);
    const kinds = await recentEventKinds(sessionId);
    expect(kinds).toEqual([]); // no audit row on no-op
  });
});

describe("getActiveLocks", () => {
  test("lists held locks; excludes expired", async () => {
    // Active lock on session A.
    const sidA = sessionId;
    const lockA = await acquireTurnLock(db, sidA);
    expect(lockA).not.toBeNull();

    // Expired lock on session B.
    const sidB = uuidv7();
    await db.insert(sessions).values({
      id: sidB,
      cookieHmac: `t-${sidB}`,
      formId: "lesser-slime",
      turnLockToken: "stale",
      turnLockExpiresAt: new Date(Date.now() - 60_000),
    });

    const locks = await getActiveLocks(db);
    const ids = locks.map((l) => l.sessionId);
    expect(ids).toContain(sidA);
    expect(ids).not.toContain(sidB);
  });
});
