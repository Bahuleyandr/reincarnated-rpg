/**
 * Phase 7 Day 38: calendar advance + cost-gate.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { users, worldCalendar, worldEvents } from "@/lib/db/schema";
import { recordCostAndCheck, getCostState } from "@/lib/ai/cost-gate";
import { advanceCalendar } from "@/lib/story/advance";
import { utcDateString } from "@/lib/energy/streak";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let userId: string;

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
    "TRUNCATE world_events, world_lore RESTART IDENTITY",
  );
  // Reset world_calendar to known state.
  await db
    .update(worldCalendar)
    .set({
      currentBook: 1,
      currentChapter: 1,
      year: 1,
      chapterStartedAt: new Date(),
    })
    .where(eq(worldCalendar.id, 1));
  // Wipe and recreate user for cost-gate tests.
  await client.unsafe(
    "TRUNCATE sessions, users RESTART IDENTITY CASCADE",
  );
  userId = uuidv7();
  await db.insert(users).values({
    id: userId,
    email: `c${userId}@x.com`,
    username: `c${userId}`,
    passwordHash: "x",
    streakCount: 1,
    streakLastDayUtc: utcDateString(new Date()),
  });
});

describe("advanceCalendar", () => {
  test("does not advance when chapter is fresh", async () => {
    const r = await advanceCalendar(db);
    expect(r.advanced).toBe(false);
    expect(r.fromChapter).toBe(1);
    expect(r.toChapter).toBe(1);
  });

  test("advances when chapter has been live longer than chapterDurationMs", async () => {
    // Backdate chapterStartedAt by 8 days.
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db
      .update(worldCalendar)
      .set({ chapterStartedAt: eightDaysAgo })
      .where(eq(worldCalendar.id, 1));

    const r = await advanceCalendar(db);
    expect(r.advanced).toBe(true);
    expect(r.fromChapter).toBe(1);
    expect(r.toChapter).toBe(2);

    // chapter.advanced world_event lands.
    const events = await db.select().from(worldEvents);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].kind).toBe("chapter.advanced");
  });
});

describe("recordCostAndCheck", () => {
  test("free user starts at $0 / $0.50 cap", async () => {
    const before = await getCostState(db, userId);
    expect(before.cap).toBe(0.5);
    expect(before.used).toBe(0);
  });

  test("bumps usage and returns allowed=true while under cap", async () => {
    const r = await recordCostAndCheck(db, userId, 0.1);
    expect(r.allowed).toBe(true);
    expect(r.used).toBeCloseTo(0.1, 5);
    expect(r.capHitJustNow).toBe(false);
  });

  test("flags capHitJustNow once when crossing the cap", async () => {
    await recordCostAndCheck(db, userId, 0.4);
    const r = await recordCostAndCheck(db, userId, 0.2);
    expect(r.allowed).toBe(false);
    expect(r.capHitJustNow).toBe(true);
    // Subsequent over-cap call: NOT capHitJustNow (already over).
    const r2 = await recordCostAndCheck(db, userId, 0.05);
    expect(r2.capHitJustNow).toBe(false);
    expect(r2.allowed).toBe(false);
  });

  test("supporter tier raises the cap", async () => {
    await db.update(users).set({ tier: "supporter" }).where(eq(users.id, userId));
    const r = await recordCostAndCheck(db, userId, 1.0);
    expect(r.cap).toBe(2);
    expect(r.allowed).toBe(true);
  });

  test("lazy reset: previous-day accrual gets cleared on the first call today", async () => {
    // Seed accrual at $0.40 with reset_at = 2 days ago.
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await db
      .update(users)
      .set({
        dailyAiCostUsdToday: 0.4,
        dailyAiCostResetAt: twoDaysAgo,
      })
      .where(eq(users.id, userId));
    const r = await recordCostAndCheck(db, userId, 0.05);
    // Should reset to 0 first, then add 0.05 → 0.05.
    expect(r.used).toBeCloseTo(0.05, 5);
    expect(r.allowed).toBe(true);
  });
});
