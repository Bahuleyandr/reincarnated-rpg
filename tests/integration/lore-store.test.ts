/**
 * Lore store — the read/write layer for the GLOBAL world_lore
 * ledger. Tests:
 *   - promoteToLore writes only when judgment.salient is true
 *   - recentLore returns rows ordered by salience+recency
 *   - recallLore falls back to salience-recency without embeddings
 *   - expired lore is filtered out
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { worldLore } from "@/lib/db/schema";
import {
  promoteToLore,
  recallLore,
  recentLore,
} from "@/lib/lore/store";
import type { JudgmentResult } from "@/lib/lore/judge";

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
    "TRUNCATE world_lore RESTART IDENTITY CASCADE",
  );
});

const winningJudgment = (
  override: Partial<JudgmentResult> = {},
): JudgmentResult => ({
  salient: true,
  salience: 0.85,
  category: "city-event",
  tags: ["wyrm", "salt-cathedral"],
  summary: "The salt cathedral fell to the wyrm during a blue-moon tide.",
  prose:
    "The chronicle records that the wyrm rose into the salt cathedral on a blue-moon tide and that nothing of the cathedral remained but salt-water in the sea-cave.",
  ...override,
});

describe("promoteToLore", () => {
  test("writes a row when judgment.salient is true", async () => {
    const r = await promoteToLore(db, winningJudgment(), {
      formId: "lesser-slime",
      locationId: "salt-cathedral",
      phase: "rising",
    });
    expect(r).not.toBeNull();
    expect(r!.salience).toBeCloseTo(0.85, 2);
    expect(r!.category).toBe("city-event");
    expect(r!.summary).toMatch(/cathedral/i);
    const all = await db.select().from(worldLore);
    expect(all).toHaveLength(1);
  });

  test("returns null and writes nothing when judgment.salient is false", async () => {
    const r = await promoteToLore(
      db,
      winningJudgment({ salient: false, salience: 0.3 }),
      { formId: "lesser-slime", locationId: "collapsed-tunnel" },
    );
    expect(r).toBeNull();
    const all = await db.select().from(worldLore);
    expect(all).toHaveLength(0);
  });
});

describe("recentLore", () => {
  test("returns rows sorted by salience then recency", async () => {
    const a = await promoteToLore(
      db,
      winningJudgment({ salience: 0.7, summary: "older lower-sal entry" }),
      { formId: "lesser-slime", locationId: "x" },
    );
    const b = await promoteToLore(
      db,
      winningJudgment({ salience: 0.95, summary: "newer higher-sal" }),
      { formId: "lesser-slime", locationId: "x" },
    );
    const c = await promoteToLore(
      db,
      winningJudgment({ salience: 0.7, summary: "newer same-sal" }),
      { formId: "lesser-slime", locationId: "x" },
    );
    const lore = await recentLore(db, 10);
    expect(lore).toHaveLength(3);
    // 0.95 first, then 0.7s with newer first
    expect(lore[0].id).toBe(b!.id);
    expect(lore[1].id).toBe(c!.id);
    expect(lore[2].id).toBe(a!.id);
  });

  test("filters out expired entries", async () => {
    const r = await promoteToLore(db, winningJudgment(), {
      formId: "lesser-slime",
      locationId: "x",
    });
    await db
      .update(worldLore)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(worldLore.id, r!.id));
    const lore = await recentLore(db);
    expect(lore).toHaveLength(0);
  });
});

describe("recallLore", () => {
  test("falls back to salience-recency when no query text", async () => {
    await promoteToLore(
      db,
      winningJudgment({ salience: 0.9, summary: "high-sal" }),
      { formId: "lesser-slime", locationId: "x" },
    );
    await promoteToLore(
      db,
      winningJudgment({ salience: 0.65, summary: "lower-sal" }),
      { formId: "lesser-slime", locationId: "x" },
    );
    const r = await recallLore(db, "", 10);
    expect(r).toHaveLength(2);
    expect(r[0].summary).toBe("high-sal");
  });
});
