/**
 * Economy telemetry integration: rollupCoinEvents upserts
 * coin_flow_daily; readDailyEconomy reads back top sources.
 *
 * Phase 5 Day 26.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import {
  readDailyEconomy,
  rollupCoinEvents,
} from "@/lib/economy/telemetry";
import type { Event } from "@/lib/game/types";

let client: postgres.Sql;
let db: Db;

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
  await client.unsafe("TRUNCATE coin_flow_daily RESTART IDENTITY CASCADE");
});

describe("rollupCoinEvents", () => {
  test("inserts a fresh row per source", async () => {
    const events: Event[] = [
      { kind: "coins.gained", amount: 36, source: "vendor:tutorial-vendor" },
      { kind: "coins.spent", amount: 80, sink: "trainer:old-vassi" },
    ];
    await rollupCoinEvents(db, events, "2026-05-04");
    const snapshot = await readDailyEconomy(db, "2026-05-04");
    expect(snapshot.inflow).toBe(36);
    expect(snapshot.outflow).toBe(-80);
    expect(snapshot.net).toBe(-44);
    const sources = new Map(
      snapshot.topSources.map((s) => [s.source, s.amount]),
    );
    expect(sources.get("vendor:tutorial-vendor")).toBe(36);
    expect(sources.get("trainer:old-vassi")).toBe(-80);
  });

  test("upserts: a second turn from the same source merges into the row", async () => {
    await rollupCoinEvents(
      db,
      [{ kind: "coins.gained", amount: 30, source: "vendor:v1" }],
      "2026-05-04",
    );
    await rollupCoinEvents(
      db,
      [{ kind: "coins.gained", amount: 12, source: "vendor:v1" }],
      "2026-05-04",
    );
    const snapshot = await readDailyEconomy(db, "2026-05-04");
    expect(snapshot.inflow).toBe(42);
    expect(snapshot.topSources[0].count).toBe(2);
  });

  test("different dates stay isolated", async () => {
    await rollupCoinEvents(
      db,
      [{ kind: "coins.gained", amount: 10, source: "vendor:v1" }],
      "2026-05-03",
    );
    await rollupCoinEvents(
      db,
      [{ kind: "coins.gained", amount: 50, source: "vendor:v1" }],
      "2026-05-04",
    );
    const day1 = await readDailyEconomy(db, "2026-05-03");
    const day2 = await readDailyEconomy(db, "2026-05-04");
    expect(day1.inflow).toBe(10);
    expect(day2.inflow).toBe(50);
  });

  test("empty event list is a no-op", async () => {
    await rollupCoinEvents(db, [], "2026-05-04");
    const snapshot = await readDailyEconomy(db, "2026-05-04");
    expect(snapshot.topSources).toEqual([]);
    expect(snapshot.net).toBe(0);
  });
});

describe("readDailyEconomy", () => {
  test("returns empty snapshot for a date with no flow", async () => {
    const snapshot = await readDailyEconomy(db, "2026-01-01");
    expect(snapshot.inflow).toBe(0);
    expect(snapshot.outflow).toBe(0);
    expect(snapshot.net).toBe(0);
    expect(snapshot.topSources).toEqual([]);
  });

  test("topSources sorts by absolute amount", async () => {
    await rollupCoinEvents(
      db,
      [
        { kind: "coins.gained", amount: 5, source: "small" },
        { kind: "coins.gained", amount: 100, source: "big" },
        { kind: "coins.spent", amount: 50, sink: "medium" },
      ],
      "2026-05-04",
    );
    const snapshot = await readDailyEconomy(db, "2026-05-04");
    expect(snapshot.topSources[0].source).toBe("big");
    expect(snapshot.topSources[1].source).toBe("medium");
    expect(snapshot.topSources[2].source).toBe("small");
  });
});
