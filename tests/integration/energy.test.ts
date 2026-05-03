/**
 * Energy persistence integration: trySpend, getEnergyView, and admin
 * controls round-trip through users + sessions tables.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import {
  adminSetEnergy,
  getEnergyView,
  trySpend,
} from "@/lib/energy/state";
import { TIERS } from "@/lib/energy/tiers";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let userId: string;
let sessionId: string;

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
    "TRUNCATE sessions, users RESTART IDENTITY CASCADE",
  );
  userId = uuidv7();
  // Explicit createdAt pin so the blessing-window logic gets a
  // predictable value. Without this the Postgres-side defaultNow()
  // can race with subsequent reads under heavy test load.
  const now = new Date();
  await db.insert(users).values({
    id: userId,
    email: `t${userId}@x.com`,
    username: `t${userId}`,
    passwordHash: "x",
    createdAt: now,
    updatedAt: now,
  });
  sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `t-${sessionId}`,
    formId: "lesser-slime",
    startedAt: now,
  });
});

describe("getEnergyView", () => {
  test("returns the default state for a fresh user (free + blessed because just created)", async () => {
    const v = await getEnergyView(db, { userId });
    expect(v).not.toBeNull();
    // Fresh user = blessed by Blessing of the Gods. Tier label is
    // still "Free" but the cap is doubled (40) and regen is faster.
    expect(v!.tierId).toBe("free");
    expect(v!.tier.max).toBe(40); // 20 * 2 = blessed cap
    expect(v!.blessing?.id).toBe("blessing-of-the-gods");
  });

  test("anon session reads from sessions row", async () => {
    const v = await getEnergyView(db, { sessionId });
    expect(v).not.toBeNull();
    expect(v!.tierId).toBe("free");
    // Test setup inserts session with default energy=20 and
    // startedAt=now → blessing active. Test fixtures pre-date the
    // blessing so they don't seed at the blessed cap; we just
    // assert the cap is the blessed one.
    expect(v!.tier.max).toBe(40);
    expect(v!.blessing?.id).toBe("blessing-of-the-gods");
  });
});

describe("trySpend", () => {
  test("decrements when above zero", async () => {
    const r = await trySpend(db, { userId });
    expect(r.ok).toBe(true);
    expect(r.view!.energy).toBe(TIERS.free.max - 1);
    const reread = await getEnergyView(db, { userId });
    expect(reread!.energy).toBe(TIERS.free.max - 1);
  });

  test("refuses when at zero, returns refilled view", async () => {
    // Force energy to 0.
    await db
      .update(users)
      .set({ energy: 0, energyUpdatedAt: new Date() })
      .where(eq(users.id, userId));
    const r = await trySpend(db, { userId });
    expect(r.ok).toBe(false);
    expect(r.view!.energy).toBe(0);
    expect(r.view!.nextRegenMs).toBeGreaterThan(0);
  });

  test("refills before refusing if interval(s) elapsed", async () => {
    // 0 energy, lastUpdated 50min ago. Test user is blessed
    // (created NOW), so regen is at 20min interval — 50min/20min =
    // 2 ticks, refilled to 2, then spend 1 → 1.
    await db
      .update(users)
      .set({
        energy: 0,
        energyUpdatedAt: sql`now() - interval '50 minutes'`,
      })
      .where(eq(users.id, userId));
    const r = await trySpend(db, { userId });
    expect(r.ok).toBe(true);
    expect(r.view!.energy).toBe(1);
  });

  test("anon session decrements separately from any user", async () => {
    await trySpend(db, { sessionId });
    await trySpend(db, { sessionId });
    const v = await getEnergyView(db, { sessionId });
    expect(v!.energy).toBe(TIERS.free.max - 2);
    // The user is unaffected.
    const u = await getEnergyView(db, { userId });
    expect(u!.energy).toBe(TIERS.free.max);
  });
});

describe("adminSetEnergy", () => {
  test("promotes to supporter and refills to new max", async () => {
    const v = await adminSetEnergy(db, userId, {
      tier: "supporter",
      refillToMax: true,
    });
    expect(v!.tier.id).toBe("supporter");
    expect(v!.energy).toBe(TIERS.supporter.max);
  });

  test("setEnergy clamps to current EFFECTIVE tier max (blessed = 40)", async () => {
    // Test user was created in beforeEach (NOW), so the blessing
    // is active. Effective free-tier cap is 40, not 20.
    const v = await adminSetEnergy(db, userId, {
      setEnergy: 999,
    });
    expect(v!.energy).toBe(40);
  });

  test("setEnergy clamps below zero", async () => {
    const v = await adminSetEnergy(db, userId, {
      setEnergy: -10,
    });
    expect(v!.energy).toBe(0);
  });

  test("returns null for unknown user", async () => {
    const v = await adminSetEnergy(db, uuidv7(), {
      refillToMax: true,
    });
    expect(v).toBeNull();
  });

  test("changing tier without refill keeps current energy (clamped to new max if necessary)", async () => {
    // Promote to patron without refill — energy stays where it was
    // (default 20), well under patron's 120.
    await trySpend(db, { userId }); // 19
    const v = await adminSetEnergy(db, userId, { tier: "patron" });
    expect(v!.tier.id).toBe("patron");
    expect(v!.energy).toBe(19);
  });
});

describe("Blessing of the Gods integration", () => {
  test("brand-new user is blessed (free tier, cap 40, blessing surface)", async () => {
    const v = await getEnergyView(db, { userId });
    expect(v!.tierId).toBe("free");
    expect(v!.tier.id).toBe("free"); // tier label preserved as 'Free'
    expect(v!.tier.max).toBe(40);
    expect(v!.tier.regenIntervalMs).toBe(20 * 60 * 1000);
    expect(v!.blessing?.id).toBe("blessing-of-the-gods");
    expect(v!.blessingExpiresAtMs).not.toBeNull();
  });

  test("user older than 7 days is NOT blessed", async () => {
    // Backdate the user's createdAt by 8 days.
    await db
      .update(users)
      .set({ createdAt: sql`now() - interval '8 days'` })
      .where(eq(users.id, userId));
    const v = await getEnergyView(db, { userId });
    expect(v!.tier.max).toBe(20);
    expect(v!.tier.regenIntervalMs).toBe(45 * 60 * 1000);
    expect(v!.blessing).toBeNull();
  });

  test("blessed user can hold up to 40 energy when refilled", async () => {
    await db
      .update(users)
      .set({ energy: 40, energyUpdatedAt: new Date() })
      .where(eq(users.id, userId));
    const v = await getEnergyView(db, { userId });
    expect(v!.energy).toBe(40);
    expect(v!.nextRegenMs).toBe(0); // at max
  });

  test("blessed regen runs faster (20min vs 45min)", async () => {
    // 0 energy, 25min ago → 1 tick at 20min interval = 1 energy
    await db
      .update(users)
      .set({
        energy: 0,
        energyUpdatedAt: sql`now() - interval '25 minutes'`,
      })
      .where(eq(users.id, userId));
    const v = await getEnergyView(db, { userId });
    expect(v!.energy).toBe(1);
  });

  test("admin promoting a blessed user to supporter removes the blessing", async () => {
    const v = await adminSetEnergy(db, userId, {
      tier: "supporter",
      refillToMax: true,
    });
    expect(v!.tier.id).toBe("supporter");
    expect(v!.tier.max).toBe(60);
    expect(v!.blessing).toBeNull(); // paid tiers don't get blessed
  });

  test("admin demoting back to free within 7d resumes the blessing", async () => {
    await adminSetEnergy(db, userId, { tier: "supporter" });
    const back = await adminSetEnergy(db, userId, { tier: "free" });
    expect(back!.tier.id).toBe("free");
    expect(back!.blessing?.id).toBe("blessing-of-the-gods");
    expect(back!.tier.max).toBe(40);
  });
});
