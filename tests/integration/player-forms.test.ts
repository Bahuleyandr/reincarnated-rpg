/**
 * Player-authored forms — submit + approve/reject pipeline.
 */
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { playerForms, users } from "@/lib/db/schema";
import {
  allocateSlug,
  approveSubmission,
  rejectSubmission,
  submitForm,
} from "@/lib/forms/submit";
import { utcDateString } from "@/lib/energy/streak";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let userId: string;
let adminUserId: string;
const cleanupSlugs: string[] = [];

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
    "TRUNCATE player_forms, sessions, users RESTART IDENTITY CASCADE",
  );
  userId = uuidv7();
  adminUserId = uuidv7();
  const now = new Date();
  const today = utcDateString(now);
  await db.insert(users).values([
    {
      id: userId,
      email: `u${userId}@x.com`,
      username: `u${userId}`,
      passwordHash: "x",
      createdAt: now,
      updatedAt: now,
      streakCount: 1,
      streakLastDayUtc: today,
    },
    {
      id: adminUserId,
      email: `a${adminUserId}@x.com`,
      username: `a${adminUserId}`,
      passwordHash: "x",
      isAdmin: "true",
      createdAt: now,
      updatedAt: now,
      streakCount: 1,
      streakLastDayUtc: today,
    },
  ]);
});

afterAll(() => {
  // Clean any test-approved files we wrote into content/forms/.
  for (const slug of cleanupSlugs) {
    const path = join(process.cwd(), "content", "forms", `${slug}.json`);
    if (existsSync(path)) unlinkSync(path);
  }
});

const VALID_SPEC = {
  vitals: { life: { max: 5, start: 5, death: 0 } },
  stats: { focus: 1 },
  verbs: ["look", "speak", "wait"],
};

describe("submitForm", () => {
  test("happy path: pending_review row created", async () => {
    const r = await submitForm(db, {
      authorUserId: userId,
      name: "Mirror Spirit",
      theme: "a reflection that talks back",
      spec: VALID_SPEC,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = await db
      .select()
      .from(playerForms)
      .where(eq(playerForms.id, r.id));
    expect(row.status).toBe("pending_review");
    expect(row.name).toBe("Mirror Spirit");
  });

  test("rejects empty / too-long name", async () => {
    expect(
      (
        await submitForm(db, {
          authorUserId: userId,
          name: "",
          theme: "x",
          spec: VALID_SPEC,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await submitForm(db, {
          authorUserId: userId,
          name: "ab",
          theme: "x",
          spec: VALID_SPEC,
        })
      ).ok,
    ).toBe(false);
  });

  test("rejects too-few or too-many verbs", async () => {
    expect(
      (
        await submitForm(db, {
          authorUserId: userId,
          name: "Test Form",
          theme: "test",
          spec: { ...VALID_SPEC, verbs: ["only"] },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await submitForm(db, {
          authorUserId: userId,
          name: "Test Form",
          theme: "test",
          spec: {
            ...VALID_SPEC,
            verbs: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
          },
        })
      ).ok,
    ).toBe(false);
  });
});

describe("allocateSlug", () => {
  test("returns kebab-case ascii slug", async () => {
    const slug = await allocateSlug(db, "Mirror Spirit!");
    expect(slug).toMatch(/^mirror-spirit/);
  });

  test("appends -2 etc. on collision", async () => {
    // Manually insert a row with approvedFormId='conflict-form'
    const id1 = uuidv7();
    const now = new Date();
    await db.insert(playerForms).values({
      id: id1,
      authorUserId: userId,
      name: "Conflict",
      theme: "t",
      spec: VALID_SPEC,
      status: "approved",
      approvedFormId: "conflict-form",
      submittedAt: now,
    });
    const slug = await allocateSlug(db, "Conflict Form");
    expect(slug).toBe("conflict-form-2");
  });
});

describe("approveSubmission + rejectSubmission", () => {
  test("approve writes content file + flips status", async () => {
    const submission = await submitForm(db, {
      authorUserId: userId,
      name: "Approval Test",
      theme: "test",
      spec: VALID_SPEC,
    });
    if (!submission.ok) throw new Error("submit failed");
    const r = await approveSubmission(db, {
      submissionId: submission.id,
      reviewerUserId: adminUserId,
      notes: "looks fine",
    });
    expect(r.ok).toBe(true);
    if (!r.approvedFormId) throw new Error("no slug");
    cleanupSlugs.push(r.approvedFormId);
    const [row] = await db
      .select()
      .from(playerForms)
      .where(eq(playerForms.id, submission.id));
    expect(row.status).toBe("approved");
    expect(row.approvedFormId).toBe(r.approvedFormId);
    expect(existsSync(r.filePath!)).toBe(true);
  });

  test("approve fails on non-pending submission", async () => {
    const submission = await submitForm(db, {
      authorUserId: userId,
      name: "Test",
      theme: "test",
      spec: VALID_SPEC,
    });
    if (!submission.ok) throw new Error("submit failed");
    const first = await approveSubmission(db, {
      submissionId: submission.id,
      reviewerUserId: adminUserId,
    });
    if (first.approvedFormId) cleanupSlugs.push(first.approvedFormId);
    const second = await approveSubmission(db, {
      submissionId: submission.id,
      reviewerUserId: adminUserId,
    });
    expect(second.ok).toBe(false);
  });

  test("reject flips status + records notes", async () => {
    const submission = await submitForm(db, {
      authorUserId: userId,
      name: "Reject Test",
      theme: "test",
      spec: VALID_SPEC,
    });
    if (!submission.ok) throw new Error("submit failed");
    await rejectSubmission(db, {
      submissionId: submission.id,
      reviewerUserId: adminUserId,
      notes: "tone misaligned with the world",
    });
    const [row] = await db
      .select()
      .from(playerForms)
      .where(eq(playerForms.id, submission.id));
    expect(row.status).toBe("rejected");
    expect(row.reviewerNotes).toMatch(/tone/);
  });
});
