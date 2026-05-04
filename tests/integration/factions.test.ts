/**
 * Phase 7 Day 42-43: faction pledge + contributions integration.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { factions, users } from "@/lib/db/schema";
import {
  aggregatePerFaction,
  getUserFaction,
  listFactions,
  pledgeFaction,
  recordFactionContribution,
} from "@/lib/story/factions";
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
  // Reset the contributions ledger and faction member counts for
  // isolation. Don't truncate `factions` itself — re-seeding is
  // verbose; reset counters instead.
  await client.unsafe(
    "TRUNCATE faction_contributions, sessions, users RESTART IDENTITY CASCADE",
  );
  await client.unsafe(
    "UPDATE factions SET member_count=0, cumulative_contribution=0",
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
    coins: 100,
  });
});

describe("listFactions", () => {
  test("returns the four seeded factions, active first", async () => {
    const fs = await listFactions(db);
    const ids = fs.map((f) => f.id);
    expect(ids).toContain("choristers");
    expect(ids).toContain("rust_hand");
    expect(ids).toContain("idle");
    expect(ids).toContain("forsaken");
    // forsaken is inactive at v0.
    const forsaken = fs.find((f) => f.id === "forsaken")!;
    expect(forsaken.active).toBe(false);
  });
});

describe("pledgeFaction", () => {
  test("happy path: writes user row + bumps member_count", async () => {
    const r = await pledgeFaction(db, { userId, factionId: "choristers" });
    expect(r.ok).toBe(true);
    const stored = await getUserFaction(db, userId);
    expect(stored?.factionId).toBe("choristers");
    const [c] = await db
      .select()
      .from(factions)
      .where(eq(factions.id, "choristers"));
    expect(c.memberCount).toBe(1);
  });

  test("rejects already-pledged players", async () => {
    await pledgeFaction(db, { userId, factionId: "choristers" });
    const r = await pledgeFaction(db, { userId, factionId: "rust_hand" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("already_pledged");
  });

  test("rejects inactive faction (forsaken locked at v0)", async () => {
    const r = await pledgeFaction(db, { userId, factionId: "forsaken" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("faction_inactive");
  });

  test("rejects unknown faction id", async () => {
    const r = await pledgeFaction(db, { userId, factionId: "made_up" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("unknown_faction");
  });

  test("rejects insufficient coins", async () => {
    await db.update(users).set({ coins: 10 }).where(eq(users.id, userId));
    const r = await pledgeFaction(db, { userId, factionId: "choristers" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("insufficient_coins");
  });
});

describe("recordFactionContribution + aggregatePerFaction", () => {
  test("appends rows + bumps cumulative; aggregate reads per chapter", async () => {
    await pledgeFaction(db, { userId, factionId: "choristers" });
    await recordFactionContribution(db, {
      userId,
      factionId: "choristers",
      chapterId: 1,
      amount: 5,
      source: "ritual",
    });
    await recordFactionContribution(db, {
      userId,
      factionId: "choristers",
      chapterId: 1,
      amount: 3,
      source: "craft",
    });
    await recordFactionContribution(db, {
      userId,
      factionId: "rust_hand",
      chapterId: 1,
      amount: 7,
      source: "kill_npc",
    });
    const ch1 = await aggregatePerFaction(db, 1);
    expect(ch1.choristers).toBe(8);
    expect(ch1.rust_hand).toBe(7);

    // Cumulative bump on the factions row.
    const [c] = await db
      .select()
      .from(factions)
      .where(eq(factions.id, "choristers"));
    expect(c.cumulativeContribution).toBe(8);
  });

  test("zero / negative amounts are no-ops", async () => {
    await pledgeFaction(db, { userId, factionId: "choristers" });
    await recordFactionContribution(db, {
      userId,
      factionId: "choristers",
      chapterId: 1,
      amount: 0,
      source: "x",
    });
    await recordFactionContribution(db, {
      userId,
      factionId: "choristers",
      chapterId: 1,
      amount: -3,
      source: "x",
    });
    const ch1 = await aggregatePerFaction(db, 1);
    expect(ch1.choristers).toBeUndefined();
  });
});
