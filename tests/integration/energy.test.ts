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
  await db.insert(users).values({
    id: userId,
    email: `t${Date.now()}@x.com`,
    username: `t${Date.now()}`,
    passwordHash: "x",
  });
  sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `t-${sessionId}`,
    formId: "lesser-slime",
  });
});

describe("getEnergyView", () => {
  test("returns the default state for a fresh user (free tier, full)", async () => {
    const v = await getEnergyView(db, { userId });
    expect(v).not.toBeNull();
    expect(v!.tier.id).toBe("free");
    expect(v!.energy).toBe(TIERS.free.max);
  });

  test("anon session reads from sessions row", async () => {
    const v = await getEnergyView(db, { sessionId });
    expect(v).not.toBeNull();
    expect(v!.tier.id).toBe("free");
    expect(v!.energy).toBe(TIERS.free.max);
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
    // 0 energy, lastUpdated 50min ago → +1 tick → 1 energy → trySpend allows
    await db
      .update(users)
      .set({
        energy: 0,
        energyUpdatedAt: sql`now() - interval '50 minutes'`,
      })
      .where(eq(users.id, userId));
    const r = await trySpend(db, { userId });
    expect(r.ok).toBe(true);
    expect(r.view!.energy).toBe(0);
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

  test("setEnergy clamps to current tier max", async () => {
    const v = await adminSetEnergy(db, userId, {
      setEnergy: 999,
    });
    expect(v!.energy).toBe(TIERS.free.max);
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
    // (free max = 20), well under patron's 120.
    await trySpend(db, { userId }); // 19
    const v = await adminSetEnergy(db, userId, { tier: "patron" });
    expect(v!.tier.id).toBe("patron");
    expect(v!.energy).toBe(19);
  });
});
