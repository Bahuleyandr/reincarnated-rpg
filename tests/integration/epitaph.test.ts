/**
 * Phase 5.5 Day 30: epitaph submission + location-tied lore read.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { campaigns, users, worldLore } from "@/lib/db/schema";
import { recentLocationLore } from "@/lib/locations/lore";
import { utcDateString } from "@/lib/energy/streak";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let userId: string;
let campaignId: string;

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
    "TRUNCATE world_lore, campaigns, sessions, users RESTART IDENTITY CASCADE",
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
    streakCount: 1,
    streakLastDayUtc: utcDateString(now),
  });
  campaignId = uuidv7();
  await db.insert(campaigns).values({
    id: campaignId,
    userId,
    title: "Run 1",
    formId: "lesser-slime",
    locationId: "collapsed-tunnel",
    status: "abandoned",
    createdAt: now,
    updatedAt: now,
  });
});

describe("recentLocationLore", () => {
  test("excludes entries newer than 24h (delay rule)", async () => {
    const id = uuidv7();
    await db.insert(worldLore).values({
      id,
      summary: "i was almost something",
      salience: 0.7,
      category: "epitaph",
      tags: ["epitaph", "lesser-slime"],
      sourceCampaignId: campaignId,
      sourceUserId: userId,
      sourceLocationId: "collapsed-tunnel",
      sourceFormId: "lesser-slime",
      adminRedacted: false,
      // Just-now (well within 24h delay)
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const lore = await recentLocationLore(db, "collapsed-tunnel", {
      category: "epitaph",
    });
    expect(lore).toEqual([]);
  });

  test("includes entries older than 24h", async () => {
    const id = uuidv7();
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db.insert(worldLore).values({
      id,
      summary: "the silence here is wrong",
      salience: 0.7,
      category: "epitaph",
      tags: ["epitaph"],
      sourceCampaignId: campaignId,
      sourceUserId: userId,
      sourceLocationId: "collapsed-tunnel",
      sourceFormId: "lesser-slime",
      adminRedacted: false,
      createdAt: yesterday,
      updatedAt: yesterday,
    });
    const lore = await recentLocationLore(db, "collapsed-tunnel", {
      category: "epitaph",
    });
    expect(lore).toHaveLength(1);
    expect(lore[0].summary).toBe("the silence here is wrong");
    expect(lore[0].sourceFormId).toBe("lesser-slime");
  });

  test("filters by location and category", async () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    // wrong location
    await db.insert(worldLore).values({
      id: uuidv7(),
      summary: "wrong place",
      salience: 0.7,
      category: "epitaph",
      tags: ["epitaph"],
      sourceLocationId: "salt-cathedral",
      adminRedacted: false,
      createdAt: yesterday,
      updatedAt: yesterday,
    });
    // wrong category
    await db.insert(worldLore).values({
      id: uuidv7(),
      summary: "famous death",
      salience: 0.7,
      category: "famous_death",
      tags: ["famous_death"],
      sourceLocationId: "collapsed-tunnel",
      adminRedacted: false,
      createdAt: yesterday,
      updatedAt: yesterday,
    });
    // matching
    await db.insert(worldLore).values({
      id: uuidv7(),
      summary: "the right one",
      salience: 0.7,
      category: "epitaph",
      tags: ["epitaph"],
      sourceLocationId: "collapsed-tunnel",
      adminRedacted: false,
      createdAt: yesterday,
      updatedAt: yesterday,
    });
    const lore = await recentLocationLore(db, "collapsed-tunnel", {
      category: "epitaph",
    });
    expect(lore.map((l) => l.summary)).toEqual(["the right one"]);
  });

  test("excludes admin-redacted entries", async () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db.insert(worldLore).values({
      id: uuidv7(),
      summary: "redacted",
      salience: 0.7,
      category: "epitaph",
      tags: ["epitaph"],
      sourceLocationId: "collapsed-tunnel",
      adminRedacted: true,
      createdAt: yesterday,
      updatedAt: yesterday,
    });
    const lore = await recentLocationLore(db, "collapsed-tunnel", {
      category: "epitaph",
    });
    expect(lore).toEqual([]);
  });

  test("orders by salience DESC then createdAt DESC", async () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const dayBefore = new Date(Date.now() - 49 * 60 * 60 * 1000);
    await db.insert(worldLore).values([
      {
        id: uuidv7(),
        summary: "low",
        salience: 0.3,
        category: "epitaph",
        tags: ["epitaph"],
        sourceLocationId: "collapsed-tunnel",
        adminRedacted: false,
        createdAt: yesterday,
        updatedAt: yesterday,
      },
      {
        id: uuidv7(),
        summary: "high",
        salience: 0.9,
        category: "epitaph",
        tags: ["epitaph"],
        sourceLocationId: "collapsed-tunnel",
        adminRedacted: false,
        createdAt: dayBefore,
        updatedAt: dayBefore,
      },
    ]);
    const lore = await recentLocationLore(db, "collapsed-tunnel", {
      category: "epitaph",
    });
    expect(lore[0].summary).toBe("high");
    expect(lore[1].summary).toBe("low");
  });

  test("respects limit", async () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    for (let i = 0; i < 5; i++) {
      await db.insert(worldLore).values({
        id: uuidv7(),
        summary: `entry ${i}`,
        salience: 0.5 + i * 0.05,
        category: "epitaph",
        tags: ["epitaph"],
        sourceLocationId: "collapsed-tunnel",
        adminRedacted: false,
        createdAt: yesterday,
        updatedAt: yesterday,
      });
    }
    const lore = await recentLocationLore(db, "collapsed-tunnel", {
      category: "epitaph",
      limit: 2,
    });
    expect(lore).toHaveLength(2);
  });
});

void eq;
