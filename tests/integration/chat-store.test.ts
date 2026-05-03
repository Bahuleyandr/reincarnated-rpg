/**
 * Chat store integration: postMessage round-trips, recentMessages
 * orders chronologically, messagesSince filters to fresh rows,
 * 1-hour read window cuts off old messages.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";

import {
  CHAT_MAX_LENGTH,
  messagesSince,
  postMessage,
  recentMessages,
} from "@/lib/chat/store";
import type { Db } from "@/lib/db/client";
import { roomMessages, sessions, users } from "@/lib/db/schema";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let userA: string;
let userB: string;
let sessionA: string;
let sessionB: string;

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
    "TRUNCATE room_messages, sessions, users RESTART IDENTITY CASCADE",
  );
  userA = uuidv7();
  userB = uuidv7();
  await db.insert(users).values([
    {
      id: userA,
      email: `a${Date.now()}@x.com`,
      username: `a${Date.now()}`,
      passwordHash: "x",
    },
    {
      id: userB,
      email: `b${Date.now()}@x.com`,
      username: `b${Date.now()}`,
      passwordHash: "x",
    },
  ]);
  sessionA = uuidv7();
  sessionB = uuidv7();
  await db.insert(sessions).values([
    {
      id: sessionA,
      cookieHmac: `t-${sessionA}`,
      formId: "lesser-slime",
      lastActiveAt: new Date(),
    },
    {
      id: sessionB,
      cookieHmac: `t-${sessionB}`,
      formId: "cursed-book",
      lastActiveAt: new Date(),
    },
  ]);
});

describe("postMessage", () => {
  test("inserts and returns the row", async () => {
    const m = await postMessage(db, {
      locationId: "collapsed-tunnel",
      roomId: "seam-of-the-collapse",
      sessionId: sessionA,
      userId: userA,
      text: "hello",
      displayName: "a curious slime",
      username: "alice",
      formId: "lesser-slime",
    });
    expect(m.text).toBe("hello");
    expect(m.displayName).toBe("a curious slime");
    expect(m.username).toBe("alice");
    expect(m.formId).toBe("lesser-slime");
    expect(m.roomId).toBe("seam-of-the-collapse");
  });

  test("trims to CHAT_MAX_LENGTH", async () => {
    const long = "x".repeat(CHAT_MAX_LENGTH + 50);
    const m = await postMessage(db, {
      locationId: "collapsed-tunnel",
      roomId: "seam-of-the-collapse",
      sessionId: sessionA,
      userId: userA,
      text: long,
      displayName: "a",
      username: null,
      formId: "lesser-slime",
    });
    expect(m.text.length).toBe(CHAT_MAX_LENGTH);
  });

  test("rejects empty after trim", async () => {
    await expect(
      postMessage(db, {
        locationId: "x",
        roomId: "y",
        sessionId: sessionA,
        userId: userA,
        text: "   ",
        displayName: "x",
        username: null,
        formId: "lesser-slime",
      }),
    ).rejects.toThrow(/empty/i);
  });
});

describe("recentMessages", () => {
  test("returns rows in chronological order, most recent last", async () => {
    await postMessage(db, {
      locationId: "x",
      roomId: "y",
      sessionId: sessionA,
      userId: userA,
      text: "first",
      displayName: "a",
      username: null,
      formId: "lesser-slime",
    });
    await new Promise((r) => setTimeout(r, 10));
    await postMessage(db, {
      locationId: "x",
      roomId: "y",
      sessionId: sessionB,
      userId: userB,
      text: "second",
      displayName: "b",
      username: null,
      formId: "cursed-book",
    });
    const ms = await recentMessages(db, "x", "y");
    expect(ms.map((m) => m.text)).toEqual(["first", "second"]);
  });

  test("filters by room", async () => {
    await postMessage(db, {
      locationId: "x",
      roomId: "room-1",
      sessionId: sessionA,
      userId: userA,
      text: "in r1",
      displayName: "a",
      username: null,
      formId: "lesser-slime",
    });
    await postMessage(db, {
      locationId: "x",
      roomId: "room-2",
      sessionId: sessionB,
      userId: userB,
      text: "in r2",
      displayName: "b",
      username: null,
      formId: "cursed-book",
    });
    const r1 = await recentMessages(db, "x", "room-1");
    expect(r1).toHaveLength(1);
    expect(r1[0].text).toBe("in r1");
  });

  test("excludes messages older than the read window", async () => {
    await postMessage(db, {
      locationId: "x",
      roomId: "y",
      sessionId: sessionA,
      userId: userA,
      text: "ancient",
      displayName: "a",
      username: null,
      formId: "lesser-slime",
    });
    // Manually age it past the cutoff.
    await db
      .update(roomMessages)
      .set({ createdAt: sql`now() - interval '2 hours'` })
      .where(eq(roomMessages.sessionId, sessionA));
    await postMessage(db, {
      locationId: "x",
      roomId: "y",
      sessionId: sessionB,
      userId: userB,
      text: "fresh",
      displayName: "b",
      username: null,
      formId: "cursed-book",
    });
    const r = await recentMessages(db, "x", "y");
    expect(r.map((m) => m.text)).toEqual(["fresh"]);
  });
});

describe("messagesSince", () => {
  test("returns only rows after `since`", async () => {
    await postMessage(db, {
      locationId: "x",
      roomId: "y",
      sessionId: sessionA,
      userId: userA,
      text: "first",
      displayName: "a",
      username: null,
      formId: "lesser-slime",
    });
    await new Promise((r) => setTimeout(r, 20));
    const cursor = new Date();
    await new Promise((r) => setTimeout(r, 20));
    await postMessage(db, {
      locationId: "x",
      roomId: "y",
      sessionId: sessionB,
      userId: userB,
      text: "second",
      displayName: "b",
      username: null,
      formId: "cursed-book",
    });
    const r = await messagesSince(db, "x", "y", cursor);
    expect(r.map((m) => m.text)).toEqual(["second"]);
  });
});
