/**
 * Phase 5.5 Day 32-33: location notes — leave, read, vote, flag.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { locationNotes, users } from "@/lib/db/schema";
import {
  flagNote,
  leaveNote,
  NOTE_AUTO_HIDE_FLAGS,
  NOTE_MAX_ACTIVE_PER_USER,
  topNotes,
  voteNote,
} from "@/lib/locations/notes";
import { utcDateString } from "@/lib/energy/streak";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let userIdA: string;
let userIdB: string;
let userIdC: string;

async function makeUser(suffix: string): Promise<string> {
  const id = uuidv7();
  const now = new Date();
  await db.insert(users).values({
    id,
    email: `${suffix}@x.com`,
    username: `u${suffix}`,
    passwordHash: "x",
    createdAt: now,
    updatedAt: now,
    streakCount: 1,
    streakLastDayUtc: utcDateString(now),
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
    "TRUNCATE location_note_votes, location_notes, sessions, users RESTART IDENTITY CASCADE",
  );
  userIdA = await makeUser("a");
  userIdB = await makeUser("b");
  userIdC = await makeUser("c");
});

describe("leaveNote", () => {
  test("inserts a note", async () => {
    const r = await leaveNote(db, {
      userId: userIdA,
      locationId: "collapsed-tunnel",
      formId: "lesser-slime",
      text: "the rat is faster than it looks",
    });
    expect("id" in r).toBe(true);
  });

  test("rejects empty text", async () => {
    const r = await leaveNote(db, {
      userId: userIdA,
      locationId: "x",
      formId: null,
      text: "   ",
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("empty");
  });

  test("rejects too-long text", async () => {
    const r = await leaveNote(db, {
      userId: userIdA,
      locationId: "x",
      formId: null,
      text: "a".repeat(200),
    });
    expect("error" in r).toBe(true);
  });

  test(`rejects after ${NOTE_MAX_ACTIVE_PER_USER} active notes per user`, async () => {
    for (let i = 0; i < NOTE_MAX_ACTIVE_PER_USER; i++) {
      const ok = await leaveNote(db, {
        userId: userIdA,
        locationId: "x",
        formId: null,
        text: `note ${i}`,
      });
      expect("id" in ok).toBe(true);
    }
    const r = await leaveNote(db, {
      userId: userIdA,
      locationId: "x",
      formId: null,
      text: "one too many",
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/cap/);
  });
});

describe("topNotes", () => {
  test("returns un-flagged un-expired notes ordered by votes", async () => {
    await leaveNote(db, {
      userId: userIdA,
      locationId: "loc",
      formId: null,
      text: "a",
    });
    const b = await leaveNote(db, {
      userId: userIdA,
      locationId: "loc",
      formId: null,
      text: "b",
    });
    if (!("id" in b)) throw new Error("b not created");
    await voteNote(db, { noteId: b.id, userId: userIdB });
    const top = await topNotes(db, "loc");
    expect(top[0].text).toBe("b");
  });

  test("filters by formId (matching null OR exact match)", async () => {
    await leaveNote(db, {
      userId: userIdA,
      locationId: "loc",
      formId: "cursed-book",
      text: "book-only",
    });
    await leaveNote(db, {
      userId: userIdA,
      locationId: "loc",
      formId: null,
      text: "any-form",
    });
    const slimeView = await topNotes(db, "loc", { formId: "lesser-slime" });
    expect(slimeView.map((n) => n.text)).toEqual(["any-form"]);
    const bookView = await topNotes(db, "loc", { formId: "cursed-book" });
    expect(bookView.map((n) => n.text).sort()).toEqual([
      "any-form",
      "book-only",
    ]);
  });

  test("excludes flagged + expired notes", async () => {
    const note = await leaveNote(db, {
      userId: userIdA,
      locationId: "loc",
      formId: null,
      text: "flagged",
    });
    if (!("id" in note)) throw new Error("note not created");
    await db
      .update(locationNotes)
      .set({ flagged: true })
      .where(eq(locationNotes.id, note.id));
    const top = await topNotes(db, "loc");
    expect(top).toEqual([]);
  });
});

describe("voteNote", () => {
  test("idempotent: second call from same user does not double-bump", async () => {
    const note = await leaveNote(db, {
      userId: userIdA,
      locationId: "loc",
      formId: null,
      text: "x",
    });
    if (!("id" in note)) throw new Error("not created");
    await voteNote(db, { noteId: note.id, userId: userIdB });
    const r2 = await voteNote(db, { noteId: note.id, userId: userIdB });
    expect(r2.alreadyVoted).toBe(true);
    const [row] = await db
      .select({ votes: locationNotes.votes })
      .from(locationNotes)
      .where(eq(locationNotes.id, note.id));
    expect(row.votes).toBe(1);
  });

  test("different users compose to multiple votes", async () => {
    const note = await leaveNote(db, {
      userId: userIdA,
      locationId: "loc",
      formId: null,
      text: "x",
    });
    if (!("id" in note)) throw new Error("not created");
    await voteNote(db, { noteId: note.id, userId: userIdB });
    await voteNote(db, { noteId: note.id, userId: userIdC });
    const [row] = await db
      .select({ votes: locationNotes.votes })
      .from(locationNotes)
      .where(eq(locationNotes.id, note.id));
    expect(row.votes).toBe(2);
  });
});

describe("flagNote", () => {
  test(`auto-hides at ${NOTE_AUTO_HIDE_FLAGS} distinct flaggers`, async () => {
    const note = await leaveNote(db, {
      userId: userIdA,
      locationId: "loc",
      formId: null,
      text: "spam",
    });
    if (!("id" in note)) throw new Error("not created");

    const r1 = await flagNote(db, { noteId: note.id, userId: userIdA });
    expect(r1.flagged).toBe(false);
    const r2 = await flagNote(db, { noteId: note.id, userId: userIdB });
    expect(r2.flagged).toBe(false);
    const r3 = await flagNote(db, { noteId: note.id, userId: userIdC });
    expect(r3.flagged).toBe(true);
    // Should now disappear from top reads.
    expect(await topNotes(db, "loc")).toEqual([]);
  });
});
