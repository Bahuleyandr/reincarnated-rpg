/**
 * Phase 5.5 Day 36-37: tutorial graduation + skip flow.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import { graduateTutorial, skipTutorial } from "@/lib/tutorial/graduate";
import { utcDateString } from "@/lib/energy/streak";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let userId: string;
let tutorialSessionId: string;

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
    tutorialCompleted: false,
  });
  tutorialSessionId = uuidv7();
  await db.insert(sessions).values({
    id: tutorialSessionId,
    cookieHmac: `t-${tutorialSessionId}`,
    formId: "lesser-slime",
    isTutorial: true,
  });
});

describe("graduateTutorial", () => {
  test("flips tutorial_completed on user", async () => {
    const r = await graduateTutorial(db, tutorialSessionId, userId);
    expect(r.graduated).toBe(true);
    const [row] = await db
      .select({ done: users.tutorialCompleted })
      .from(users)
      .where(eq(users.id, userId));
    expect(row.done).toBe(true);
  });

  test("non-tutorial session is a no-op", async () => {
    // Flip the session's is_tutorial to false manually.
    await db
      .update(sessions)
      .set({ isTutorial: false })
      .where(eq(sessions.id, tutorialSessionId));
    const r = await graduateTutorial(db, tutorialSessionId, userId);
    expect(r.graduated).toBe(false);
    const [row] = await db
      .select({ done: users.tutorialCompleted })
      .from(users)
      .where(eq(users.id, userId));
    expect(row.done).toBe(false);
  });
});

describe("skipTutorial", () => {
  test("flips both flags", async () => {
    const r = await skipTutorial(db, tutorialSessionId, userId);
    expect(r.skipped).toBe(true);
    const [u] = await db
      .select({ done: users.tutorialCompleted })
      .from(users)
      .where(eq(users.id, userId));
    expect(u.done).toBe(true);
    const [s] = await db
      .select({ isT: sessions.isTutorial })
      .from(sessions)
      .where(eq(sessions.id, tutorialSessionId));
    expect(s.isT).toBe(false);
  });
});
