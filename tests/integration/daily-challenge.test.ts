/**
 * Daily shared-seed loop — DB integration.
 *
 * Verifies the reservation contract (one row per user per day),
 * progress updates, leaderboard ordering, and per-user history.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import {
  dailyLeaderboard,
  findDailyForSession,
  getDailyStatus,
  reserveDailyRun,
  updateDailyProgress,
  userDailyHistory,
} from "@/lib/daily/challenge";
import type { Db } from "@/lib/db/client";
import { dailyRuns, sessions, users } from "@/lib/db/schema";
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
  return id;
}

async function makeSession(): Promise<string> {
  const id = uuidv7();
  await db.insert(sessions).values({
    id,
    cookieHmac: id.replace(/-/g, ""),
    formId: "lesser-slime",
    energy: 32,
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
    "TRUNCATE daily_runs, sessions, users RESTART IDENTITY CASCADE",
  );
});

describe("reserveDailyRun", () => {
  test("first attempt of the day succeeds and writes the row", async () => {
    const userId = await makeUser("alice");
    const sessionId = await makeSession();
    const r = await reserveDailyRun(db, {
      userId,
      utcDate: "2026-05-04",
      sessionId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sessionId).toBe(sessionId);
    expect(r.challenge.utcDate).toBe("2026-05-04");

    const [row] = await db
      .select()
      .from(dailyRuns)
      .where(eq(dailyRuns.userId, userId));
    expect(row.utcDate).toBe("2026-05-04");
    expect(row.sessionId).toBe(sessionId);
    expect(row.formId).toBe(r.challenge.formId);
    expect(row.status).toBe("active");
  });

  test("second attempt the same day rejects with already_played", async () => {
    const userId = await makeUser("bob");
    const s1 = await makeSession();
    const s2 = await makeSession();
    const a = await reserveDailyRun(db, {
      userId,
      utcDate: "2026-05-04",
      sessionId: s1,
    });
    expect(a.ok).toBe(true);
    const b = await reserveDailyRun(db, {
      userId,
      utcDate: "2026-05-04",
      sessionId: s2,
    });
    expect(b.ok).toBe(false);
    if (b.ok) return;
    expect(b.error).toBe("already_played");
  });

  test("the same user can play different days back-to-back", async () => {
    const userId = await makeUser("carla");
    const a = await reserveDailyRun(db, {
      userId,
      utcDate: "2026-05-03",
      sessionId: await makeSession(),
    });
    const b = await reserveDailyRun(db, {
      userId,
      utcDate: "2026-05-04",
      sessionId: await makeSession(),
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe("getDailyStatus", () => {
  test("returns null run for a user who hasn't started", async () => {
    const userId = await makeUser("noplay");
    const s = await getDailyStatus(db, {
      userId,
      utcDate: "2026-05-04",
    });
    expect(s.run).toBeNull();
    expect(s.challenge.utcDate).toBe("2026-05-04");
  });

  test("returns the run after reserve", async () => {
    const userId = await makeUser("did-play");
    const sessionId = await makeSession();
    await reserveDailyRun(db, {
      userId,
      utcDate: "2026-05-04",
      sessionId,
    });
    const s = await getDailyStatus(db, {
      userId,
      utcDate: "2026-05-04",
    });
    expect(s.run?.sessionId).toBe(sessionId);
    expect(s.run?.status).toBe("active");
  });
});

describe("updateDailyProgress", () => {
  test("active → won updates status, score, and ended_at", async () => {
    const userId = await makeUser("winner");
    const sessionId = await makeSession();
    await reserveDailyRun(db, {
      userId,
      utcDate: "2026-05-04",
      sessionId,
    });
    await updateDailyProgress(db, {
      userId,
      utcDate: "2026-05-04",
      status: "won",
      turnCount: 7,
    });
    const [row] = await db
      .select()
      .from(dailyRuns)
      .where(eq(dailyRuns.userId, userId));
    expect(row.status).toBe("won");
    expect(row.turnCount).toBe(7);
    expect(row.score).toBeGreaterThan(10000);
    expect(row.endedAt).not.toBeNull();
  });

  test("active progress sets score but leaves ended_at null", async () => {
    const userId = await makeUser("ongoing");
    const sessionId = await makeSession();
    await reserveDailyRun(db, {
      userId,
      utcDate: "2026-05-04",
      sessionId,
    });
    await updateDailyProgress(db, {
      userId,
      utcDate: "2026-05-04",
      status: "active",
      turnCount: 3,
    });
    const [row] = await db
      .select()
      .from(dailyRuns)
      .where(eq(dailyRuns.userId, userId));
    expect(row.status).toBe("active");
    expect(row.turnCount).toBe(3);
    expect(row.endedAt).toBeNull();
  });
});

describe("dailyLeaderboard", () => {
  test("orders rows by score DESC and includes username", async () => {
    const a = await makeUser("aaa");
    const b = await makeUser("bbb");
    const c = await makeUser("ccc");
    const sa = await makeSession();
    const sb = await makeSession();
    const sc = await makeSession();
    const utc = "2026-05-04";
    await reserveDailyRun(db, { userId: a, utcDate: utc, sessionId: sa });
    await reserveDailyRun(db, { userId: b, utcDate: utc, sessionId: sb });
    await reserveDailyRun(db, { userId: c, utcDate: utc, sessionId: sc });
    await updateDailyProgress(db, {
      userId: a,
      utcDate: utc,
      status: "won",
      turnCount: 5,
    });
    await updateDailyProgress(db, {
      userId: b,
      utcDate: utc,
      status: "dead",
      turnCount: 3,
    });
    await updateDailyProgress(db, {
      userId: c,
      utcDate: utc,
      status: "capped",
      turnCount: 10,
    });
    const rows = await dailyLeaderboard(db, { utcDate: utc });
    expect(rows.length).toBe(3);
    // won (a) ranks first, capped (c) second, dead (b) third.
    expect(rows[0].username).toBe("aaa");
    expect(rows[0].status).toBe("won");
    expect(rows[1].username).toBe("ccc");
    expect(rows[1].status).toBe("capped");
    expect(rows[2].username).toBe("bbb");
    expect(rows[2].status).toBe("dead");
  });

  test("excludes other days' runs", async () => {
    const userId = await makeUser("d1");
    const s = await makeSession();
    await reserveDailyRun(db, {
      userId,
      utcDate: "2026-05-03",
      sessionId: s,
    });
    const rows = await dailyLeaderboard(db, { utcDate: "2026-05-04" });
    expect(rows.length).toBe(0);
  });
});

describe("findDailyForSession + history", () => {
  test("findDailyForSession returns the daily binding when the session is one", async () => {
    const userId = await makeUser("hist");
    const sessionId = await makeSession();
    await reserveDailyRun(db, {
      userId,
      utcDate: "2026-05-04",
      sessionId,
    });
    const found = await findDailyForSession(db, sessionId);
    expect(found?.userId).toBe(userId);
    expect(found?.utcDate).toBe("2026-05-04");
  });

  test("findDailyForSession returns null for a non-daily session", async () => {
    const sessionId = await makeSession();
    const found = await findDailyForSession(db, sessionId);
    expect(found).toBeNull();
  });

  test("userDailyHistory returns rows newest-first, capped at days arg", async () => {
    const userId = await makeUser("h2");
    for (let i = 1; i <= 5; i++) {
      const sessionId = await makeSession();
      await reserveDailyRun(db, {
        userId,
        utcDate: `2026-05-0${i}`,
        sessionId,
      });
    }
    const all = await userDailyHistory(db, { userId, days: 10 });
    expect(all.length).toBe(5);
    expect(all[0].utcDate).toBe("2026-05-05");
    expect(all[4].utcDate).toBe("2026-05-01");
    const capped = await userDailyHistory(db, { userId, days: 3 });
    expect(capped.length).toBe(3);
    expect(capped[0].utcDate).toBe("2026-05-05");
  });
});
