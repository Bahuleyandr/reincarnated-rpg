/**
 * Phase 7 Day 44: branch resolution integration.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { branchDecisions, factions, users, worldEvents } from "@/lib/db/schema";
import {
  ensureBranchesSeeded,
  resolveBranchesForChapter,
} from "@/lib/story/branches";
import { recordFactionContribution } from "@/lib/story/factions";
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
    "TRUNCATE branch_decisions, faction_contributions, world_events, world_lore, sessions, users RESTART IDENTITY CASCADE",
  );
  await client.unsafe(
    "UPDATE factions SET member_count=0, cumulative_contribution=0",
  );
  userId = uuidv7();
  const now = new Date();
  await db.insert(users).values({
    id: userId,
    email: `b${userId}@x.com`,
    username: `b${userId}`,
    passwordHash: "x",
    createdAt: now,
    updatedAt: now,
    streakCount: 1,
    streakLastDayUtc: utcDateString(now),
  });
});

describe("ensureBranchesSeeded", () => {
  test("idempotent: re-running doesn't create duplicates", async () => {
    await ensureBranchesSeeded(db);
    await ensureBranchesSeeded(db);
    const rows = await db.select().from(branchDecisions);
    expect(rows.length).toBeGreaterThan(0);
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.size).toBe(rows.length);
  });
});

describe("resolveBranchesForChapter", () => {
  test("picks the highest-faction-contribution path", async () => {
    await ensureBranchesSeeded(db);
    // Branch 1 lives at chapter 4. Stack contributions for Choristers.
    await recordFactionContribution(db, {
      userId,
      factionId: "choristers",
      chapterId: 4,
      amount: 50,
      source: "ritual",
    });
    await recordFactionContribution(db, {
      userId,
      factionId: "rust_hand",
      chapterId: 4,
      amount: 10,
      source: "kill_npc",
    });

    const r = await resolveBranchesForChapter(db, 4);
    expect(r.resolved.length).toBeGreaterThan(0);
    const branch = r.resolved.find((b) => b.id === 1);
    expect(branch?.resolvedPath).toBe("choristers");

    // world_event lands.
    const events = await db.select().from(worldEvents);
    expect(events.some((e) => e.kind === "branch.resolved")).toBe(true);
  });

  test("ties fall back to defaultPath", async () => {
    await ensureBranchesSeeded(db);
    // Equal contributions on choristers + rust_hand → defaultPath
    // (idle for branch 1).
    await recordFactionContribution(db, {
      userId,
      factionId: "choristers",
      chapterId: 4,
      amount: 5,
      source: "ritual",
    });
    await recordFactionContribution(db, {
      userId,
      factionId: "rust_hand",
      chapterId: 4,
      amount: 5,
      source: "kill_npc",
    });
    const r = await resolveBranchesForChapter(db, 4);
    const branch = r.resolved.find((b) => b.id === 1);
    expect(branch?.resolvedPath).toBe("idle");
  });

  test("no-contributions case → defaultPath", async () => {
    await ensureBranchesSeeded(db);
    const r = await resolveBranchesForChapter(db, 4);
    const branch = r.resolved.find((b) => b.id === 1);
    expect(branch?.resolvedPath).toBe("idle");
  });

  test("re-running on the same chapter is idempotent (already resolved branches stay)", async () => {
    await ensureBranchesSeeded(db);
    await recordFactionContribution(db, {
      userId,
      factionId: "choristers",
      chapterId: 4,
      amount: 100,
      source: "ritual",
    });
    await resolveBranchesForChapter(db, 4);
    // Add more contributions, but second resolve shouldn't touch
    // already-resolved rows.
    await recordFactionContribution(db, {
      userId,
      factionId: "rust_hand",
      chapterId: 4,
      amount: 9999,
      source: "kill_npc",
    });
    const r = await resolveBranchesForChapter(db, 4);
    const branch = r.resolved.find((b) => b.id === 1);
    expect(branch).toBeUndefined(); // not in this run's resolved list
    const [row] = await db
      .select()
      .from(branchDecisions)
      .where(eq(branchDecisions.id, 1));
    expect(row.resolvedPath).toBe("choristers"); // first decision stuck
  });
});

void factions;
