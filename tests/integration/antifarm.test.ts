/**
 * Anti-farm caps integration: bump + check round-trip.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import {
  bumpResourceGather,
  bumpVendorFlow,
  checkResourceCap,
  checkVendorCap,
} from "@/lib/economy/antifarm";
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
    "TRUNCATE vendor_daily_flow, resource_daily_gather, sessions, users RESTART IDENTITY CASCADE",
  );
  userId = uuidv7();
  const now = new Date();
  await db.insert(users).values({
    id: userId,
    email: `f${userId}@x.com`,
    username: `f${userId}`,
    passwordHash: "x",
    createdAt: now,
    updatedAt: now,
    streakCount: 1,
    streakLastDayUtc: utcDateString(now),
  });
});

describe("vendor cap", () => {
  test("uncapped (no dailyCoinCap) → never capped", async () => {
    const r = await checkVendorCap(db, {
      userId,
      vendorTemplateId: "tutorial-vendor",
      additionalCoinsEarn: 9999,
    });
    expect(r.capped).toBe(false);
  });

  test("under cap → not capped; over cap → capped", async () => {
    await bumpVendorFlow(db, {
      userId,
      vendorTemplateId: "v1",
      coinsEarn: 150,
    });
    const under = await checkVendorCap(db, {
      userId,
      vendorTemplateId: "v1",
      dailyCoinCap: 200,
      additionalCoinsEarn: 30,
    });
    expect(under.capped).toBe(false);
    expect(under.used).toBe(150);
    const over = await checkVendorCap(db, {
      userId,
      vendorTemplateId: "v1",
      dailyCoinCap: 200,
      additionalCoinsEarn: 80,
    });
    expect(over.capped).toBe(true);
  });

  test("bumpVendorFlow upserts (date-keyed)", async () => {
    await bumpVendorFlow(db, {
      userId,
      vendorTemplateId: "v1",
      coinsEarn: 50,
    });
    await bumpVendorFlow(db, {
      userId,
      vendorTemplateId: "v1",
      coinsEarn: 30,
    });
    const r = await checkVendorCap(db, {
      userId,
      vendorTemplateId: "v1",
      dailyCoinCap: 200,
      additionalCoinsEarn: 0,
    });
    expect(r.used).toBe(80);
  });

  test("bumpVendorFlow with zero is a no-op", async () => {
    await bumpVendorFlow(db, {
      userId,
      vendorTemplateId: "v1",
      coinsEarn: 0,
    });
    const r = await checkVendorCap(db, {
      userId,
      vendorTemplateId: "v1",
      dailyCoinCap: 200,
      additionalCoinsEarn: 1,
    });
    expect(r.used).toBe(0);
  });
});

describe("resource gather cap", () => {
  test("under / over gather cap", async () => {
    await bumpResourceGather(db, {
      userId,
      resourceId: "iron-ore",
      qty: 18,
    });
    const under = await checkResourceCap(db, {
      userId,
      resourceId: "iron-ore",
      dailyGatherCap: 25,
      additionalQty: 5,
    });
    expect(under.capped).toBe(false);
    const over = await checkResourceCap(db, {
      userId,
      resourceId: "iron-ore",
      dailyGatherCap: 25,
      additionalQty: 10,
    });
    expect(over.capped).toBe(true);
  });

  test("uncapped resource (no dailyGatherCap) → never capped", async () => {
    const r = await checkResourceCap(db, {
      userId,
      resourceId: "iron-ore",
      additionalQty: 99999,
    });
    expect(r.capped).toBe(false);
  });
});
