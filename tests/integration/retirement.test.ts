/**
 * Player-as-NPC retirement (Roadmap 63) — DB integration.
 *
 * Verifies retirePlayer + the recurring-catalog merge + the
 * ascension hook write a retired_players row.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { listAllRecurring } from "@/lib/antagonist/recurring";
import type { Db } from "@/lib/db/client";
import { retiredPlayers, users } from "@/lib/db/schema";
import { utcDateString } from "@/lib/energy/streak";
import {
  listRetiredAsRecurring,
  retirePlayer,
} from "@/lib/retirement/retire";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;

async function makeUser(username: string): Promise<string> {
  const id = uuidv7();
  const now = new Date();
  await db.insert(users).values({
    id,
    email: `${username}@x.com`,
    username,
    passwordHash: "x",
    createdAt: now,
    updatedAt: now,
    streakCount: 1,
    streakLastDayUtc: utcDateString(now),
    coins: 0,
  });
  return id;
}

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
    "TRUNCATE retired_players, users RESTART IDENTITY CASCADE",
  );
});

describe("retirePlayer", () => {
  test("ascension retirement writes the row with ascension defaults", async () => {
    const userId = await makeUser("alex");
    const r = await retirePlayer(db, {
      userId,
      reason: "ascension",
      factionId: "choristers",
      topSkillId: "alchemy",
      topSkillLevel: 7,
      totalCampaigns: 55,
      distinctForms: 4,
      lastWords: "Tend the long song.",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.templateId).toBe("retired:alex");

    const [row] = await db
      .select()
      .from(retiredPlayers)
      .where(eq(retiredPlayers.userId, userId));
    expect(row.displayName).toBe("alex, the ascended");
    expect(row.reason).toBe("ascension");
    expect(row.factionId).toBe("choristers");
    expect(row.topSkillId).toBe("alchemy");
    expect(row.topSkillLevel).toBe(7);
    expect(row.totalCampaigns).toBe(55);
    expect(row.distinctForms).toBe(4);
    expect(row.lastWords).toBe("Tend the long song.");
    // Default appearance probability shape.
    expect(row.baseLow).toBeCloseTo(0.02);
    expect(row.maxAppear).toBeCloseTo(0.25);
  });

  test("permadeath retirement reads 'the lost'", async () => {
    const userId = await makeUser("noor");
    const r = await retirePlayer(db, {
      userId,
      reason: "permadeath",
      factionId: null,
      topSkillId: null,
      topSkillLevel: 0,
      totalCampaigns: 12,
      distinctForms: 2,
    });
    expect(r.ok).toBe(true);
    const [row] = await db
      .select()
      .from(retiredPlayers)
      .where(eq(retiredPlayers.userId, userId));
    expect(row.displayName).toBe("noor, the lost");
    expect(row.lastWords).toBeNull();
  });

  test("second retirement of the same user rejects with already_retired", async () => {
    const userId = await makeUser("twice");
    const a = await retirePlayer(db, {
      userId,
      reason: "ascension",
      factionId: null,
      topSkillId: null,
      topSkillLevel: 0,
      totalCampaigns: 50,
      distinctForms: 4,
    });
    expect(a.ok).toBe(true);
    const b = await retirePlayer(db, {
      userId,
      reason: "ascension",
      factionId: null,
      topSkillId: null,
      topSkillLevel: 0,
      totalCampaigns: 50,
      distinctForms: 4,
    });
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.error).toBe("already_retired");
  });

  test("retiring a non-existent user returns user_not_found", async () => {
    const r = await retirePlayer(db, {
      userId: uuidv7(),
      reason: "ascension",
      factionId: null,
      topSkillId: null,
      topSkillLevel: 0,
      totalCampaigns: 50,
      distinctForms: 4,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("user_not_found");
  });
});

describe("listRetiredAsRecurring", () => {
  test("returns retired players shaped as RecurringNpcMeta", async () => {
    const userId = await makeUser("retiree");
    await retirePlayer(db, {
      userId,
      reason: "ascension",
      factionId: "rust_hand",
      topSkillId: "smithing",
      topSkillLevel: 9,
      totalCampaigns: 60,
      distinctForms: 5,
      lastWords: "I held the iron when no one else would.",
    });
    const list = await listRetiredAsRecurring(db);
    expect(list.length).toBe(1);
    const r = list[0];
    expect(r.templateId).toBe("retired:retiree");
    expect(r.recurring).toBe(true);
    expect(r.faction).toBe("rust_hand");
    expect(r.topicsOfInterest).toEqual(
      expect.arrayContaining([
        "faction:rust_hand",
        "skill:smithing",
        "ascension",
      ]),
    );
    expect(r.appearanceProbability.baseLow).toBeCloseTo(0.02);
    expect(r.appearanceProbability.maxAppearanceProbability).toBeCloseTo(0.25);
  });

  test("listAllRecurring merges file catalog + retired pool", async () => {
    const userId = await makeUser("merger");
    await retirePlayer(db, {
      userId,
      reason: "ascension",
      factionId: "idle",
      topSkillId: null,
      topSkillLevel: 0,
      totalCampaigns: 50,
      distinctForms: 4,
    });
    const merged = await listAllRecurring(db);
    // The retired player must be in the merged list…
    const retired = merged.find((m) => m.templateId === "retired:merger");
    expect(retired).toBeDefined();
    // …and the merge is sorted by templateId.
    const ids = merged.map((m) => m.templateId);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});
