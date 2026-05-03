/**
 * Integration test for the reincarnation picker. Drives the live-DB
 * distribution path: seed campaigns, query the picker, assert that
 * over-represented forms get penalized and under-represented ones
 * surface with bonus skills.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { campaigns, users } from "@/lib/db/schema";
import {
  _resetCatalogCacheForTests,
  findOption,
  liveDistribution,
  offerReincarnations,
} from "@/lib/game/reincarnation-picker";
import { uuidv7 } from "@/lib/util/uuidv7";

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
  await client.unsafe(
    "TRUNCATE meta_contributions, meta_arcs, world_memories, world_npcs, memories, entities, projections, events, sessions, campaigns, users RESTART IDENTITY CASCADE",
  );
  _resetCatalogCacheForTests();
});

async function seedCampaign(formId: string): Promise<void> {
  const userId = uuidv7();
  const u = `u${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  await db.insert(users).values({
    id: userId,
    email: `${u}@x.com`,
    username: u,
    passwordHash: "x",
  });
  await db.insert(campaigns).values({
    id: uuidv7(),
    userId,
    title: "seed",
    formId,
    locationId: "collapsed-tunnel",
  });
}

describe("liveDistribution", () => {
  test("counts active campaigns by formId", async () => {
    await seedCampaign("lesser-slime");
    await seedCampaign("lesser-slime");
    await seedCampaign("cursed-book");
    const dist = await liveDistribution(db);
    expect(dist.get("lesser-slime")).toBe(2);
    expect(dist.get("cursed-book")).toBe(1);
  });
});

describe("offerReincarnations", () => {
  test("returns N options on an empty world", async () => {
    const r = await offerReincarnations(db, { n: 6 });
    expect(r.options).toHaveLength(6);
    expect(r.totalActive).toBe(0);
    // No saturation when nothing exists
    expect(r.options.every((o) => !o.saturated)).toBe(true);
  });

  test("when one form saturates, options routing to it carry saturated=true", async () => {
    // Seed enough lesser-slime campaigns to push past 50% share.
    for (let i = 0; i < 20; i++) await seedCampaign("lesser-slime");
    await seedCampaign("cursed-book");
    // Try several offers to assert the rule probabilistically.
    let sawSlimeFlagged = false;
    let sawSlimeAtAll = false;
    for (let i = 0; i < 10; i++) {
      const r = await offerReincarnations(db, { n: 6 });
      for (const o of r.options) {
        if (o.typedFormHint === "lesser-slime") {
          sawSlimeAtAll = true;
          if (o.saturated) sawSlimeFlagged = true;
        }
      }
    }
    // Either slime appears (and is flagged) or it gets crowded out
    // entirely — both prove the saturation logic is working.
    if (sawSlimeAtAll) expect(sawSlimeFlagged).toBe(true);
  });

  test("guarantees a rare option with bonus when any form saturates", async () => {
    for (let i = 0; i < 20; i++) await seedCampaign("lesser-slime");
    await seedCampaign("cursed-book");
    const r = await offerReincarnations(db, { n: 6 });
    const rares = r.options.filter(
      (o) => o.tier === "rare" && o.starterBonus,
    );
    expect(rares.length).toBeGreaterThanOrEqual(1);
  });

  test("excludes specific formIds", async () => {
    const r = await offerReincarnations(db, {
      n: 6,
      excludeFormIds: ["lesser-slime"],
    });
    for (const o of r.options) {
      expect(o.typedFormHint).not.toBe("lesser-slime");
    }
  });

  test("respects weight overrides", async () => {
    // Set the rare 'frost-on-window' weight to 0 → should never appear
    const r = await offerReincarnations(db, {
      n: 6,
      weightOverrides: { "frost-on-window": 0 },
    });
    expect(r.options.some((o) => o.id === "frost-on-window")).toBe(false);
  });
});

describe("findOption", () => {
  test("returns the option by id", () => {
    const o = findOption("lesser-slime");
    expect(o?.label).toMatch(/slime/i);
    expect(o?.typedFormHint).toBe("lesser-slime");
  });

  test("returns null for unknown ids", () => {
    expect(findOption("does-not-exist")).toBeNull();
  });

  test("finds options with starterBonus payload", () => {
    const o = findOption("wandering-candle");
    expect(o?.starterBonus).toEqual({ field: "kindling", value: 1 });
  });
});
