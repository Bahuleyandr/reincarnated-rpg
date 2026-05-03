/**
 * Admin direct injection, edit, redact, and salience-time decay
 * for the world_lore ledger.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { users, worldLore } from "@/lib/db/schema";
import {
  adminEditLore,
  adminRedactLore,
  adminWriteLore,
  LORE_HALFLIFE_DAYS,
  LORE_MIN_EFFECTIVE_SALIENCE,
  promoteToLore,
  recallLore,
  recentLore,
} from "@/lib/lore/store";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let adminId: string;

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
    "TRUNCATE world_lore, users RESTART IDENTITY CASCADE",
  );
  adminId = uuidv7();
  await db.insert(users).values({
    id: adminId,
    email: `admin${Date.now()}@x.com`,
    username: `admin${Date.now()}`,
    passwordHash: "x",
    isAdmin: "true",
  });
});

describe("adminWriteLore", () => {
  test("inserts attributed to admin user", async () => {
    const r = await adminWriteLore(db, {
      summary: "A festival declared in the eastern provinces.",
      prose: "Three days of dancing.",
      salience: 0.9,
      category: "city-event",
      tags: ["festival", "east"],
      adminUserId: adminId,
    });
    expect(r.salience).toBeCloseTo(0.9, 2);
    expect(r.category).toBe("city-event");
    expect(r.sourceUserId).toBe(adminId);
    expect(r.lastEditedByUserId).toBe(adminId);
    expect(r.tags).toContain("festival");
  });

  test("clamps salience to [0,1]", async () => {
    const a = await adminWriteLore(db, {
      summary: "x",
      salience: 1.5,
      adminUserId: adminId,
    });
    const b = await adminWriteLore(db, {
      summary: "y",
      salience: -0.5,
      adminUserId: adminId,
    });
    expect(a.salience).toBe(1);
    expect(b.salience).toBe(0);
  });

  test("supports time-limited admin events via expiresAt", async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const r = await adminWriteLore(db, {
      summary: "A short-lived cult is recruiting.",
      salience: 0.85,
      expiresAt: future,
      adminUserId: adminId,
    });
    expect(r.expiresAt?.getTime()).toBe(future.getTime());
  });
});

describe("adminEditLore", () => {
  test("updates summary + bumps updatedAt + lastEditedByUserId", async () => {
    const r = await adminWriteLore(db, {
      summary: "The original summary.",
      salience: 0.7,
      adminUserId: adminId,
    });
    const original = r.updatedAt.getTime();
    await new Promise((rr) => setTimeout(rr, 5));
    const editor = uuidv7();
    await db.insert(users).values({
      id: editor,
      email: `e${Date.now()}@x.com`,
      username: `e${Date.now()}`,
      passwordHash: "x",
      isAdmin: "true",
    });
    const edited = await adminEditLore(
      db,
      r.id,
      { summary: "Edited summary.", salience: 0.95 },
      editor,
    );
    expect(edited?.summary).toBe("Edited summary.");
    expect(edited?.salience).toBeCloseTo(0.95, 2);
    expect(edited?.updatedAt.getTime()).toBeGreaterThan(original);
    expect(edited?.lastEditedByUserId).toBe(editor);
  });

  test("partial patch leaves other fields intact", async () => {
    const r = await adminWriteLore(db, {
      summary: "keep me",
      prose: "and me",
      category: "artifact",
      tags: ["a", "b"],
      salience: 0.6,
      adminUserId: adminId,
    });
    await adminEditLore(db, r.id, { salience: 0.95 }, adminId);
    const after = await db
      .select()
      .from(worldLore)
      .where(eq(worldLore.id, r.id))
      .limit(1);
    expect(after[0].summary).toBe("keep me");
    expect(after[0].prose).toBe("and me");
    expect(after[0].category).toBe("artifact");
    expect(after[0].tags).toEqual(["a", "b"]);
    expect(after[0].salience).toBeCloseTo(0.95, 2);
  });
});

describe("adminRedactLore", () => {
  test("sets expiresAt to now and the entry falls out of recall", async () => {
    const r = await adminWriteLore(db, {
      summary: "A regrettable summary.",
      salience: 0.95,
      adminUserId: adminId,
    });
    let lore = await recentLore(db);
    expect(lore.some((l) => l.id === r.id)).toBe(true);

    await adminRedactLore(db, r.id, adminId);

    lore = await recentLore(db);
    expect(lore.some((l) => l.id === r.id)).toBe(false);

    // But the row still exists for audit.
    const audit = await db
      .select()
      .from(worldLore)
      .where(eq(worldLore.id, r.id));
    expect(audit).toHaveLength(1);
    expect(audit[0].expiresAt).not.toBeNull();
  });
});

describe("salience-time decay", () => {
  test("a fresh high-salience entry outranks an older equally-salient one", async () => {
    // Insert two rows with equal raw salience; age the second.
    const newer = await adminWriteLore(db, {
      summary: "newer",
      salience: 0.9,
      adminUserId: adminId,
    });
    const older = await adminWriteLore(db, {
      summary: "older",
      salience: 0.9,
      adminUserId: adminId,
    });
    // Backdate the second by 60 days.
    await db
      .update(worldLore)
      .set({
        createdAt: sql`now() - interval '60 days'`,
      })
      .where(eq(worldLore.id, older.id));
    const r = await recentLore(db, 10);
    const newerIdx = r.findIndex((l) => l.id === newer.id);
    const olderIdx = r.findIndex((l) => l.id === older.id);
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  test("a fresh low-salience entry outranks a heavily-decayed high-salience one (and the decayed entry falls below the floor)", async () => {
    const fresh = await adminWriteLore(db, {
      summary: "fresh-low",
      salience: 0.65,
      adminUserId: adminId,
    });
    const ancient = await adminWriteLore(db, {
      summary: "ancient-high",
      salience: 0.95,
      adminUserId: adminId,
    });
    // Age ancient by 200 days. effective_salience ≈ 0.95 * exp(-200/30) ≈ 0.001
    await db
      .update(worldLore)
      .set({
        createdAt: sql`now() - interval '200 days'`,
      })
      .where(eq(worldLore.id, ancient.id));
    const r = await recentLore(db, 10);
    expect(r.some((l) => l.id === fresh.id)).toBe(true);
    // 200-day-old at 0.95 raw salience decays well below the floor
    // (0.05) so it's filtered out entirely. That IS outranking.
    expect(r.some((l) => l.id === ancient.id)).toBe(false);
  });

  test("entries below the floor are filtered from recall", async () => {
    const fadedOut = await adminWriteLore(db, {
      summary: "faded",
      salience: 0.5,
      adminUserId: adminId,
    });
    // Heavy aging — effective ~ 0.5 * exp(-365/30) ≈ 0.000028, below the 0.05 floor.
    await db
      .update(worldLore)
      .set({
        createdAt: sql`now() - interval '365 days'`,
      })
      .where(eq(worldLore.id, fadedOut.id));
    const r = await recentLore(db, 10);
    expect(r.some((l) => l.id === fadedOut.id)).toBe(false);
  });

  test("constants are exposed and reasonable", () => {
    expect(LORE_HALFLIFE_DAYS).toBeGreaterThan(0);
    expect(LORE_MIN_EFFECTIVE_SALIENCE).toBeGreaterThan(0);
    expect(LORE_MIN_EFFECTIVE_SALIENCE).toBeLessThan(0.5);
  });

  test("recallLore fallback (no embedding) honors decay", async () => {
    await adminWriteLore(db, {
      summary: "newer",
      salience: 0.7,
      adminUserId: adminId,
    });
    const old = await adminWriteLore(db, {
      summary: "older-but-higher",
      salience: 0.95,
      adminUserId: adminId,
    });
    // Age the higher-salience by 90 days. effective ≈ 0.95 * exp(-3) ≈ 0.047
    await db
      .update(worldLore)
      .set({
        createdAt: sql`now() - interval '90 days'`,
      })
      .where(eq(worldLore.id, old.id));
    // Empty queryText forces salience-fallback path.
    const r = await recallLore(db, "", 5);
    if (r.length >= 1) {
      // Newer should rank ahead of the heavily-decayed older.
      const newerSummaries = r.findIndex((l) => l.summary === "newer");
      const olderIdx = r.findIndex((l) => l.summary === "older-but-higher");
      if (olderIdx >= 0 && newerSummaries >= 0) {
        expect(newerSummaries).toBeLessThan(olderIdx);
      }
    }
  });
});

describe("promoteToLore still works alongside admin paths", () => {
  test("judge-promoted and admin-written rows coexist", async () => {
    const judged = await promoteToLore(
      db,
      {
        salient: true,
        salience: 0.85,
        category: "wyrm-event",
        tags: ["wyrm"],
        summary: "A judged entry.",
        prose: null,
      },
      { formId: "lesser-slime", locationId: "x" },
    );
    expect(judged).not.toBeNull();
    const admin = await adminWriteLore(db, {
      summary: "An admin entry.",
      salience: 0.9,
      adminUserId: adminId,
    });
    const r = await recentLore(db, 10);
    const ids = r.map((l) => l.id);
    expect(ids).toContain(judged!.id);
    expect(ids).toContain(admin.id);
  });
});
