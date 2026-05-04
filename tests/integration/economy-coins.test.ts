/**
 * Coin balance integration: applyCoinDelta against users.coins and
 * sessions.coins; migrateAnonCoinsIntoUser lifts session purse to user.
 *
 * Phase 5 Day 18-19.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import {
  applyCoinDelta,
  getCoins,
  migrateAnonCoinsIntoUser,
} from "@/lib/economy/coins";
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
  await db.insert(users).values({
    id: userId,
    email: `t${userId}@x.com`,
    username: `t${userId}`,
    passwordHash: "x",
    createdAt: now,
    updatedAt: now,
    coins: 50,
  });
  sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `c${sessionId}`,
    formId: "lesser-slime",
    coins: 0,
  });
});

describe("getCoins", () => {
  test("reads user balance when userId provided", async () => {
    expect(await getCoins(db, { userId })).toBe(50);
  });

  test("reads session balance when sessionId provided", async () => {
    expect(await getCoins(db, { sessionId })).toBe(0);
  });

  test("returns 0 for unknown ids", async () => {
    expect(await getCoins(db, { userId: uuidv7() })).toBe(0);
  });
});

describe("applyCoinDelta", () => {
  test("adds positive delta to user balance", async () => {
    const after = await applyCoinDelta(db, { userId }, 25);
    expect(after).toBe(75);
    const row = await db
      .select({ c: users.coins })
      .from(users)
      .where(eq(users.id, userId));
    expect(row[0].c).toBe(75);
  });

  test("subtracts negative delta from user balance", async () => {
    const after = await applyCoinDelta(db, { userId }, -20);
    expect(after).toBe(30);
  });

  test("rejects when result would be negative (CHECK constraint)", async () => {
    await expect(applyCoinDelta(db, { userId }, -100)).rejects.toThrow();
    // Original balance unchanged.
    expect(await getCoins(db, { userId })).toBe(50);
  });

  test("works against session balance for anon", async () => {
    await applyCoinDelta(db, { sessionId }, 12);
    expect(await getCoins(db, { sessionId })).toBe(12);
  });

  test("zero delta is a no-op (returns current balance)", async () => {
    const after = await applyCoinDelta(db, { userId }, 0);
    expect(after).toBe(50);
  });
});

describe("migrateAnonCoinsIntoUser", () => {
  test("moves session.coins into users.coins and clears session", async () => {
    await applyCoinDelta(db, { sessionId }, 30);
    expect(await getCoins(db, { sessionId })).toBe(30);

    const moved = await migrateAnonCoinsIntoUser(db, sessionId, userId);
    expect(moved).toBe(30);
    expect(await getCoins(db, { userId })).toBe(80); // 50 + 30
    expect(await getCoins(db, { sessionId })).toBe(0);
  });

  test("idempotent: a second call moves nothing", async () => {
    await applyCoinDelta(db, { sessionId }, 12);
    await migrateAnonCoinsIntoUser(db, sessionId, userId);
    const moved = await migrateAnonCoinsIntoUser(db, sessionId, userId);
    expect(moved).toBe(0);
  });

  test("returns 0 for an empty anon purse", async () => {
    const moved = await migrateAnonCoinsIntoUser(db, sessionId, userId);
    expect(moved).toBe(0);
  });
});
