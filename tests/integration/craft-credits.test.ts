/**
 * Craft credits integration: counter rollover, energy-spend boundary,
 * out-of-energy reject. Phase 5 Day 20.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import {
  consumeCraftCredit,
  getCraftCredits,
  MAX_CRAFT_CREDITS,
  OutOfEnergyForCraftingError,
  refundCraftCredit,
} from "@/lib/economy/credits";
import { utcDateString } from "@/lib/energy/streak";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let userId: string;
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
    "TRUNCATE sessions, users RESTART IDENTITY CASCADE",
  );
  userId = uuidv7();
  const now = new Date();
  // Pre-seed streakLastDayUtc=today so trySpend's daily-streak claim
  // is a no-op for these tests (we're isolating credit-pool mechanics
  // from the energy-grant gate).
  const todayUtc = utcDateString(now);
  await db.insert(users).values({
    id: userId,
    email: `t${userId}@x.com`,
    username: `t${userId}`,
    passwordHash: "x",
    createdAt: now,
    updatedAt: now,
    energy: 5,
    energyUpdatedAt: now,
    craftCredits: 10,
    streakCount: 1,
    streakLastDayUtc: todayUtc,
  });
  sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `c${sessionId}`,
    formId: "lesser-slime",
    energy: 5,
    energyUpdatedAt: now,
    craftCredits: 10,
    streakCount: 1,
    streakLastDayUtc: todayUtc,
  });
});

describe("consumeCraftCredit", () => {
  test("decrements pool and returns spentEnergy=false when pool > 0", async () => {
    const r = await consumeCraftCredit(db, { userId });
    expect(r.spentEnergy).toBe(false);
    expect(r.remaining).toBe(9);
    expect(await getCraftCredits(db, { userId })).toBe(9);
  });

  test("10 actions consume exactly 1 energy", async () => {
    const before = (
      await db.select({ e: users.energy }).from(users).where(eq(users.id, userId))
    )[0].e;

    // First 10 calls drain the pool to 0 with spentEnergy=false.
    for (let i = 0; i < 10; i++) {
      const r = await consumeCraftCredit(db, { userId });
      expect(r.spentEnergy).toBe(false);
    }
    expect(await getCraftCredits(db, { userId })).toBe(0);

    // 11th call refills the pool to 10 (then -1) AND charges 1 energy.
    const r = await consumeCraftCredit(db, { userId });
    expect(r.spentEnergy).toBe(true);
    expect(r.remaining).toBe(MAX_CRAFT_CREDITS - 1);

    const after = (
      await db.select({ e: users.energy }).from(users).where(eq(users.id, userId))
    )[0].e;
    expect(after).toBe(before - 1);
  });

  test("rejects with OutOfEnergyForCraftingError when pool empty + no energy", async () => {
    // Drain the pool first.
    for (let i = 0; i < 10; i++) {
      await consumeCraftCredit(db, { userId });
    }
    expect(await getCraftCredits(db, { userId })).toBe(0);
    // Drain energy to 0 directly.
    await db
      .update(users)
      .set({ energy: 0, energyUpdatedAt: new Date() })
      .where(eq(users.id, userId));

    await expect(consumeCraftCredit(db, { userId })).rejects.toThrow(
      OutOfEnergyForCraftingError,
    );
    // Pool still at 0; no rollover happened.
    expect(await getCraftCredits(db, { userId })).toBe(0);
  });

  test("works against session pool for anon", async () => {
    const r = await consumeCraftCredit(db, { sessionId });
    expect(r.spentEnergy).toBe(false);
    expect(r.remaining).toBe(9);
  });
});

describe("refundCraftCredit", () => {
  test("returns one credit to the pool", async () => {
    await consumeCraftCredit(db, { userId }); // pool 9
    const r = await refundCraftCredit(db, { userId });
    expect(r).toBe(10);
  });

  test("caps at MAX_CRAFT_CREDITS", async () => {
    const r = await refundCraftCredit(db, { userId }); // pool already 10
    expect(r).toBe(10);
  });
});
