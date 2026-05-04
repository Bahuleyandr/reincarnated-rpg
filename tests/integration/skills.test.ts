/**
 * Skills integration: learn from trainer, can't learn twice, XP
 * accumulates + level recomputes. Phase 5 Day 23-24.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { userSkills, users } from "@/lib/db/schema";
import {
  awardXp,
  getUserSkill,
  learnSkill,
  listUserSkills,
  xpForLevel,
} from "@/lib/economy/skills";
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
    "TRUNCATE user_skills, sessions, users RESTART IDENTITY CASCADE",
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
});

describe("learnSkill", () => {
  test("creates a user_skills row at level 1", async () => {
    const r = await learnSkill(db, userId, "smithing", "master-halrik");
    expect(r.newlyLearned).toBe(true);
    const stored = await getUserSkill(db, userId, "smithing");
    expect(stored?.level).toBe(1);
    expect(stored?.xp).toBe(0);
    expect(stored?.learnedFromNpcId).toBe("master-halrik");
  });

  test("idempotent: second learn returns newlyLearned=false", async () => {
    await learnSkill(db, userId, "smithing", "master-halrik");
    const r = await learnSkill(db, userId, "smithing", "another-trainer");
    expect(r.newlyLearned).toBe(false);
    // The original learnedFromNpcId is preserved.
    const stored = await getUserSkill(db, userId, "smithing");
    expect(stored?.learnedFromNpcId).toBe("master-halrik");
  });

  test("rejects unknown skill ids", async () => {
    await expect(
      learnSkill(db, userId, "nonsense-skill", "no-trainer"),
    ).rejects.toThrow();
  });
});

describe("awardXp", () => {
  beforeEach(async () => {
    await learnSkill(db, userId, "smithing", "master-halrik");
  });

  test("bumps xp and recomputes level", async () => {
    const r = await awardXp(db, userId, "smithing", 60);
    expect(r).not.toBeNull();
    expect(r!.xp).toBe(60);
    // sqrt(60/50) = 1.09 -> level 1; previousLevel=1
    expect(r!.level).toBe(1);
    expect(r!.leveledUp).toBe(false);
  });

  test("crosses level threshold + flags leveledUp", async () => {
    // Push past xpForLevel(2)=200.
    const r = await awardXp(db, userId, "smithing", 250);
    expect(r).not.toBeNull();
    expect(r!.level).toBe(2);
    expect(r!.previousLevel).toBe(1);
    expect(r!.leveledUp).toBe(true);
  });

  test("returns null when player doesn't know the skill", async () => {
    const r = await awardXp(db, userId, "alchemy", 50);
    expect(r).toBeNull();
  });

  test("rejects non-positive amounts (returns null)", async () => {
    expect(await awardXp(db, userId, "smithing", 0)).toBeNull();
    expect(await awardXp(db, userId, "smithing", -5)).toBeNull();
  });

  test("level never decreases", async () => {
    // Simulate level 5 (xp=1250).
    await db
      .update(userSkills)
      .set({ xp: 1250, level: 5 })
      .where(eq(userSkills.userId, userId));
    // Award a tiny amount that wouldn't be enough to reach lvl 5
    // alone — the recompute should preserve the higher level.
    const r = await awardXp(db, userId, "smithing", 1);
    expect(r!.level).toBeGreaterThanOrEqual(5);
  });

  test("xpForLevel is consistent with the storage curve", async () => {
    // For levels 1..10, awardXp(xpForLevel(N)) should land at level N.
    for (let lvl = 1; lvl <= 10; lvl++) {
      const id = uuidv7();
      const now = new Date();
      const u = uuidv7();
      await db.insert(users).values({
        id: u,
        email: `c${id}@x.com`,
        username: `c${id}`,
        passwordHash: "x",
        createdAt: now,
        updatedAt: now,
        streakCount: 1,
        streakLastDayUtc: utcDateString(now),
      });
      await learnSkill(db, u, "smithing", "master-halrik");
      const r = await awardXp(db, u, "smithing", xpForLevel(lvl));
      expect(r!.level).toBeGreaterThanOrEqual(lvl);
    }
  });
});

describe("listUserSkills", () => {
  test("returns all rows for the user", async () => {
    await learnSkill(db, userId, "smithing", "master-halrik");
    await learnSkill(db, userId, "alchemy", "mother-vael");
    const rows = await listUserSkills(db, userId);
    const ids = new Set(rows.map((r) => r.skillId));
    expect(ids.has("smithing")).toBe(true);
    expect(ids.has("alchemy")).toBe(true);
  });

  test("empty array when no skills", async () => {
    const rows = await listUserSkills(db, userId);
    expect(rows).toEqual([]);
  });
});
