/**
 * NPC-letters seeder — DB integration covering the
 * "first meet → letter in inbox, idempotent on repeat" flow.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { letters, users } from "@/lib/db/schema";
import { seedFirstMeetLetters, _resetNpcLetterCacheForTests } from "@/lib/letters/npc-letters";
import { utcDateString } from "@/lib/energy/streak";
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
  // Read-back barrier. Without this, postgres-js + Drizzle on the
  // dev WSL container has been observed to fail FK-violating inserts
  // immediately after this insert in tests that fire several follow-
  // up writes back-to-back. The select forces protocol-level sync
  // before we hand the id back to the caller.
  await client`SELECT 1 FROM users WHERE id = ${id}`;
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
  await client.unsafe("TRUNCATE letters, users RESTART IDENTITY CASCADE");
  _resetNpcLetterCacheForTests();
});

describe("seedFirstMeetLetters", () => {
  test("sends a letter from a recurring NPC to the player", async () => {
    const userId = await makeUser("alice");
    const result = await seedFirstMeetLetters({
      db,
      toUserId: userId,
      npcTemplateIds: ["rhozell"],
    });
    expect(result.sent).toEqual(["rhozell"]);
    expect(result.skipped).toEqual([]);

    const rows = await db.select().from(letters).where(eq(letters.toUserId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].fromUserId).toBeNull();
    expect(rows[0].fromNpcTemplateId).toBe("rhozell");
    expect(rows[0].subject.length).toBeGreaterThan(0);
    expect(rows[0].body.length).toBeGreaterThan(0);
    expect(rows[0].status).toBe("delivered");
  });

  test("idempotent — repeating the call doesn't send a second letter", async () => {
    const userId = await makeUser("bob");
    const first = await seedFirstMeetLetters({
      db,
      toUserId: userId,
      npcTemplateIds: ["rhozell"],
    });
    expect(first.sent).toEqual(["rhozell"]);
    const second = await seedFirstMeetLetters({
      db,
      toUserId: userId,
      npcTemplateIds: ["rhozell"],
    });
    expect(second.sent).toEqual([]);
    expect(second.skipped).toEqual(["rhozell"]);
    const count = await client`SELECT count(*)::int FROM letters WHERE to_user_id = ${userId}`;
    expect(count[0].count).toBe(1);
  });

  test("dedupes within a single call when the same NPC appears twice", async () => {
    const userId = await makeUser("carl");
    const result = await seedFirstMeetLetters({
      db,
      toUserId: userId,
      npcTemplateIds: ["rhozell", "rhozell", "rhozell"],
    });
    expect(result.sent).toEqual(["rhozell"]);
    expect(result.skipped).toEqual([]);
    const count = await client`SELECT count(*)::int FROM letters WHERE to_user_id = ${userId}`;
    expect(count[0].count).toBe(1);
  });

  test("skips NPCs without a firstMeet block", async () => {
    const userId = await makeUser("dee");
    // wrong-reader exists but isn't recurring + has no letters block.
    const result = await seedFirstMeetLetters({
      db,
      toUserId: userId,
      npcTemplateIds: ["wrong-reader"],
    });
    expect(result.sent).toEqual([]);
    expect(result.skipped).toEqual(["wrong-reader"]);
    const count = await client`SELECT count(*)::int FROM letters WHERE to_user_id = ${userId}`;
    expect(count[0].count).toBe(0);
  });

  test("multiple distinct NPCs in one call all send", async () => {
    const userId = await makeUser("eve");
    const result = await seedFirstMeetLetters({
      db,
      toUserId: userId,
      npcTemplateIds: [
        "rhozell",
        "captain-mira-of-the-anchor",
        "the-hush-reader-vohn",
      ],
    });
    expect(new Set(result.sent)).toEqual(
      new Set([
        "rhozell",
        "captain-mira-of-the-anchor",
        "the-hush-reader-vohn",
      ]),
    );
    const rows = await db.select().from(letters).where(eq(letters.toUserId, userId));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.fromNpcTemplateId))).toEqual(
      new Set([
        "rhozell",
        "captain-mira-of-the-anchor",
        "the-hush-reader-vohn",
      ]),
    );
  });

  test("CHECK constraint allows fromUserId=null when fromNpcTemplateId is set", async () => {
    const userId = await makeUser("frank");
    // This succeeds only because letters_one_sender allows null
    // from_user_id when from_npc_template_id is non-null.
    const result = await seedFirstMeetLetters({
      db,
      toUserId: userId,
      npcTemplateIds: ["rhozell"],
    });
    expect(result.sent).toHaveLength(1);
  });
});
