/**
 * Presence integration: heartbeat updates last_active_at, and
 * nearbyInRoom finds other live PCs in the same room while
 * excluding stale sessions and the requester themselves.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import {
  campaigns,
  projections,
  sessions,
  users,
} from "@/lib/db/schema";
import { heartbeat, nearbyInRoom } from "@/lib/game/presence";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;

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
    "TRUNCATE meta_contributions, meta_arcs, world_memories, world_npcs, memories, entities, projections, events, sessions, campaigns, users RESTART IDENTITY CASCADE",
  );
});

async function createPlayer(opts: {
  username: string;
  formId: string;
  locationId: string;
  roomId: string;
  reincarnatedAs?: string;
  /** Set to a timestamp older than NOW for "stale" players. */
  lastActiveAt?: Date | null;
}): Promise<string> {
  const userId = uuidv7();
  await db.insert(users).values({
    id: userId,
    email: `${opts.username}@x.com`,
    username: opts.username,
    passwordHash: "x",
  });
  const campaignId = uuidv7();
  await db.insert(campaigns).values({
    id: campaignId,
    userId,
    title: "test",
    formId: opts.formId,
    locationId: opts.locationId,
    reincarnatedAs: opts.reincarnatedAs ?? null,
  });
  const sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `t-${sessionId}`,
    formId: opts.formId,
    locationId: opts.locationId,
    reincarnatedAs: opts.reincarnatedAs ?? null,
    campaignId,
    lastActiveAt: opts.lastActiveAt ?? new Date(),
  });
  // Minimal projection so the room JSON path works.
  await db.insert(projections).values({
    sessionId,
    upToSeq: 0,
    state: {
      sessionId,
      upToSeq: 0,
      form: {
        id: opts.formId,
        vitals: {},
        vitalsMax: {},
        vitalsDeath: {},
        stats: {},
        state: {},
      },
      location: {
        id: opts.locationId,
        roomId: opts.roomId,
        discovered: [opts.roomId],
      },
      inventory: [],
      npcs: {},
      quest: { id: null, objectives: {} },
      xp: 0,
      turn: 0,
      status: "active",
      reincarnatedAs: opts.reincarnatedAs ?? null,
    },
  });
  return sessionId;
}

describe("heartbeat", () => {
  test("bumps last_active_at to NOW", async () => {
    const sid = await createPlayer({
      username: "alice",
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
      roomId: "seam-of-the-collapse",
      lastActiveAt: new Date(Date.now() - 60_000),
    });
    await heartbeat(db, sid);
    const [s] = await db
      .select({ lastActiveAt: sessions.lastActiveAt })
      .from(sessions)
      .where(eq(sessions.id, sid));
    expect(s.lastActiveAt!.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });
});

describe("nearbyInRoom", () => {
  test("finds another PC in the same room, excludes self", async () => {
    const a = await createPlayer({
      username: "alice",
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
      roomId: "seam-of-the-collapse",
      reincarnatedAs: "a curious slime",
    });
    const b = await createPlayer({
      username: "bob",
      formId: "cursed-book",
      locationId: "collapsed-tunnel",
      roomId: "seam-of-the-collapse",
      reincarnatedAs: "a passing book",
    });
    const r = await nearbyInRoom(
      db,
      "collapsed-tunnel",
      "seam-of-the-collapse",
      a,
    );
    expect(r).toHaveLength(1);
    expect(r[0].sessionId).toBe(b);
    expect(r[0].username).toBe("bob");
    expect(r[0].displayName).toBe("a passing book");
    expect(r[0].formId).toBe("cursed-book");
  });

  test("does not surface a player in a DIFFERENT room", async () => {
    const a = await createPlayer({
      username: "alice",
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
      roomId: "seam-of-the-collapse",
    });
    await createPlayer({
      username: "bob",
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
      roomId: "dripping-cavern", // different room
    });
    const r = await nearbyInRoom(
      db,
      "collapsed-tunnel",
      "seam-of-the-collapse",
      a,
    );
    expect(r).toHaveLength(0);
  });

  test("does not surface a player in a DIFFERENT location", async () => {
    const a = await createPlayer({
      username: "alice",
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
      roomId: "seam-of-the-collapse",
    });
    await createPlayer({
      username: "bob",
      formId: "lesser-slime",
      locationId: "forsaken-village",
      roomId: "seam-of-the-collapse", // matching room name, different location
    });
    const r = await nearbyInRoom(
      db,
      "collapsed-tunnel",
      "seam-of-the-collapse",
      a,
    );
    expect(r).toHaveLength(0);
  });

  test("excludes stale (>90s) sessions", async () => {
    const a = await createPlayer({
      username: "alice",
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
      roomId: "seam-of-the-collapse",
    });
    await createPlayer({
      username: "stale",
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
      roomId: "seam-of-the-collapse",
      lastActiveAt: new Date(Date.now() - 5 * 60 * 1000),
    });
    const r = await nearbyInRoom(
      db,
      "collapsed-tunnel",
      "seam-of-the-collapse",
      a,
    );
    expect(r).toHaveLength(0);
  });

  test("excludes ended sessions", async () => {
    const a = await createPlayer({
      username: "alice",
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
      roomId: "seam-of-the-collapse",
    });
    const b = await createPlayer({
      username: "dead",
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
      roomId: "seam-of-the-collapse",
    });
    await db
      .update(sessions)
      .set({ status: "dead" })
      .where(eq(sessions.id, b));
    const r = await nearbyInRoom(
      db,
      "collapsed-tunnel",
      "seam-of-the-collapse",
      a,
    );
    expect(r).toHaveLength(0);
  });

  test("anon sessions (no campaign) are surfaced via session.locationId", async () => {
    // Alice (logged-in) and Bob (anon) both in the same room.
    const a = await createPlayer({
      username: "alice",
      formId: "lesser-slime",
      locationId: "collapsed-tunnel",
      roomId: "seam-of-the-collapse",
    });
    // Anon: no campaign attached.
    const bId = uuidv7();
    await db.insert(sessions).values({
      id: bId,
      cookieHmac: `t-${bId}`,
      formId: "generic-creature",
      locationId: "collapsed-tunnel",
      reincarnatedAs: "a wandering candle",
      lastActiveAt: new Date(),
    });
    await db.insert(projections).values({
      sessionId: bId,
      upToSeq: 0,
      state: sql`${JSON.stringify({
        sessionId: bId,
        upToSeq: 0,
        form: {
          id: "generic-creature",
          vitals: {},
          vitalsMax: {},
          vitalsDeath: {},
          stats: {},
          state: {},
        },
        location: {
          id: "collapsed-tunnel",
          roomId: "seam-of-the-collapse",
          discovered: ["seam-of-the-collapse"],
        },
        inventory: [],
        npcs: {},
        quest: { id: null, objectives: {} },
        xp: 0,
        turn: 0,
        status: "active",
        reincarnatedAs: "a wandering candle",
      })}::jsonb`,
    });
    const r = await nearbyInRoom(
      db,
      "collapsed-tunnel",
      "seam-of-the-collapse",
      a,
    );
    expect(r).toHaveLength(1);
    expect(r[0].sessionId).toBe(bId);
    expect(r[0].username).toBeNull();
    expect(r[0].displayName).toBe("a wandering candle");
  });
});
