/**
 * Ascension eligibility + ascend transition.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import {
  ASCENSION_RUN_THRESHOLD,
  ASCENSION_VARIETY_THRESHOLD,
  ascend,
  checkEligibility,
} from "@/lib/ascension/eligibility";
import type { Db } from "@/lib/db/client";
import { campaigns, users, userSkills } from "@/lib/db/schema";
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
    "TRUNCATE user_skills, campaigns, sessions, users RESTART IDENTITY CASCADE",
  );
  userId = uuidv7();
  const now = new Date();
  await db.insert(users).values({
    id: userId,
    email: `a${userId}@x.com`,
    username: `a${userId}`,
    passwordHash: "x",
    createdAt: now,
    updatedAt: now,
    streakCount: 1,
    streakLastDayUtc: utcDateString(now),
    tutorialCompleted: true,
    factionId: "rust_hand",
    factionPledgedAt: now,
  });
});

async function seedCampaigns(formIds: string[]) {
  const now = new Date();
  for (const formId of formIds) {
    await db.insert(campaigns).values({
      id: uuidv7(),
      userId,
      title: `run ${formId}`,
      formId,
      locationId: "collapsed-tunnel",
      createdAt: now,
      updatedAt: now,
    });
  }
}

describe("checkEligibility", () => {
  test("brand new user → not eligible, lots needed", async () => {
    const r = await checkEligibility(db, userId);
    expect(r.eligible).toBe(false);
    expect(r.alreadyAscended).toBe(false);
    expect(r.campaignsNeeded).toBe(ASCENSION_RUN_THRESHOLD);
    expect(r.varietyNeeded).toBe(ASCENSION_VARIETY_THRESHOLD);
  });

  test("meeting the run threshold but not variety → still not eligible", async () => {
    await seedCampaigns(
      Array.from({ length: ASCENSION_RUN_THRESHOLD }, () => "lesser-slime"),
    );
    const r = await checkEligibility(db, userId);
    expect(r.eligible).toBe(false);
    expect(r.totalCampaigns).toBe(ASCENSION_RUN_THRESHOLD);
    expect(r.distinctForms).toBe(1);
    expect(r.varietyNeeded).toBe(ASCENSION_VARIETY_THRESHOLD - 1);
  });

  test("meeting variety + runs + tutorial + faction → eligible", async () => {
    const forms = ["lesser-slime", "cursed-book", "dragon-egg", "dungeon-core"];
    const flat: string[] = [];
    while (flat.length < ASCENSION_RUN_THRESHOLD) {
      for (const f of forms) {
        flat.push(f);
        if (flat.length >= ASCENSION_RUN_THRESHOLD) break;
      }
    }
    await seedCampaigns(flat);
    const r = await checkEligibility(db, userId);
    expect(r.eligible).toBe(true);
  });

  test("missing faction blocks eligibility", async () => {
    await db
      .update(users)
      .set({ factionId: null, factionPledgedAt: null })
      .where(eq(users.id, userId));
    const forms = ["lesser-slime", "cursed-book", "dragon-egg", "dungeon-core"];
    const flat: string[] = [];
    while (flat.length < ASCENSION_RUN_THRESHOLD) {
      for (const f of forms) flat.push(f);
    }
    await seedCampaigns(flat.slice(0, ASCENSION_RUN_THRESHOLD));
    const r = await checkEligibility(db, userId);
    expect(r.eligible).toBe(false);
    expect(r.hasFaction).toBe(false);
  });

  test("already ascended → alreadyAscended=true, eligible=false", async () => {
    await db
      .update(users)
      .set({
        ascendedAt: new Date(),
        ascensionFormId: "iron-hand-ascended",
        ascensionSeed: { totalCampaigns: 50 },
      })
      .where(eq(users.id, userId));
    const r = await checkEligibility(db, userId);
    expect(r.alreadyAscended).toBe(true);
    expect(r.eligible).toBe(false);
  });
});

describe("ascend", () => {
  test("rejects when not eligible", async () => {
    const r = await ascend(db, { userId });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_eligible");
  });

  test("happy path: assigns form + seed", async () => {
    const forms = ["lesser-slime", "cursed-book", "dragon-egg", "dungeon-core"];
    const flat: string[] = [];
    while (flat.length < ASCENSION_RUN_THRESHOLD) {
      for (const f of forms) flat.push(f);
    }
    await seedCampaigns(flat.slice(0, ASCENSION_RUN_THRESHOLD));
    // Top skill = smithing level 5.
    await db.insert(userSkills).values({
      id: uuidv7(),
      userId,
      skillId: "smithing",
      level: 5,
      xp: 1250,
    });

    const r = await ascend(db, { userId });
    expect(r.ok).toBe(true);
    expect(r.ascensionFormId).toBe("iron-hand-ascended");

    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    expect(u.ascendedAt).not.toBeNull();
    expect(u.ascensionFormId).toBe("iron-hand-ascended");
    const seed = u.ascensionSeed as Record<string, unknown>;
    expect(seed.factionId).toBe("rust_hand");
    expect(seed.topSkillId).toBe("smithing");
    expect(seed.totalCampaigns).toBe(ASCENSION_RUN_THRESHOLD);
  });

  test("second ascend → already_ascended", async () => {
    const forms = ["lesser-slime", "cursed-book", "dragon-egg", "dungeon-core"];
    const flat: string[] = [];
    while (flat.length < ASCENSION_RUN_THRESHOLD) {
      for (const f of forms) flat.push(f);
    }
    await seedCampaigns(flat.slice(0, ASCENSION_RUN_THRESHOLD));
    const first = await ascend(db, { userId });
    expect(first.ok).toBe(true);
    const second = await ascend(db, { userId });
    expect(second.ok).toBe(false);
    expect(second.error).toBe("already_ascended");
  });
});
