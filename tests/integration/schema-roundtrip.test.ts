/**
 * Schema round-trip — Day 2 acceptance for the Drizzle layer.
 *
 * Hits a real Postgres (loaded by `jest.setup.ts` from .env.local DATABASE_URL).
 * Each test starts from a clean session row; truncating with CASCADE wipes
 * dependent tables but bypasses the events append-only trigger (TRUNCATE
 * fires BEFORE TRUNCATE triggers, not BEFORE DELETE).
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { uuidv7 } from "@/lib/util/uuidv7";
import {
  entities,
  events,
  memories,
  projections,
  sessions,
  templatesForms,
  templatesLocations,
} from "@/lib/db/schema";

let client: postgres.Sql;
let db: ReturnType<typeof drizzle>;
let sessionId: string;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  client = postgres(url, { max: 1, onnotice: () => {} });
  db = drizzle(client);
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.unsafe(
    "TRUNCATE memories, entities, projections, events, sessions RESTART IDENTITY CASCADE",
  );
  sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `test-${sessionId}`,
    formId: "lesser-slime",
  });
});

describe("sessions", () => {
  test("inserts and reads back with defaults", async () => {
    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.formId).toBe("lesser-slime");
    expect(row.status).toBe("active");
    expect(row.turnCount).toBe(0);
    expect(row.endedAt).toBeNull();
    expect(row.startedAt).toBeInstanceOf(Date);
  });
});

describe("events (append-only)", () => {
  test("round-trips payload and orders by seq", async () => {
    const ev1 = {
      id: uuidv7(),
      sessionId,
      seq: 1,
      kind: "session.started",
      payload: { formId: "lesser-slime", seed: 42 },
      seed: 42,
    };
    const ev2 = {
      id: uuidv7(),
      sessionId,
      seq: 2,
      kind: "turn.begun",
      payload: {
        turn: 1,
        input: "I taste the air",
        inputSanitized: "I taste the air",
      },
    };
    const ev3 = {
      id: uuidv7(),
      sessionId,
      seq: 3,
      kind: "roll.resolved",
      payload: {
        roll: { d1: 4, d2: 3, mod: 0, total: 7, band: "partial", seed: 42 },
        against: "awareness",
      },
      seed: 42,
    };
    await db.insert(events).values([ev1, ev2, ev3]);

    const rows = await db
      .select()
      .from(events)
      .where(eq(events.sessionId, sessionId))
      .orderBy(events.seq);

    expect(rows.map((r) => r.kind)).toEqual([
      "session.started",
      "turn.begun",
      "roll.resolved",
    ]);
    expect(rows[1].payload).toEqual(ev2.payload);
    expect(rows[0].seed).toBe(42);
    expect(rows[1].seed).toBeNull();
  });

  test("(session_id, seq) is unique", async () => {
    await db.insert(events).values({
      id: uuidv7(),
      sessionId,
      seq: 1,
      kind: "x",
      payload: {},
    });
    await expect(
      db.insert(events).values({
        id: uuidv7(),
        sessionId,
        seq: 1,
        kind: "y",
        payload: {},
      }),
    ).rejects.toThrow();
  });

  test("UPDATE on events is blocked by trigger", async () => {
    await db.insert(events).values({
      id: uuidv7(),
      sessionId,
      seq: 1,
      kind: "x",
      payload: {},
    });
    await expect(
      client`UPDATE events SET kind = 'mutated' WHERE session_id = ${sessionId}`,
    ).rejects.toThrow(/append-only/);
  });

  test("DELETE on events is blocked by trigger", async () => {
    await db.insert(events).values({
      id: uuidv7(),
      sessionId,
      seq: 1,
      kind: "x",
      payload: {},
    });
    await expect(
      client`DELETE FROM events WHERE session_id = ${sessionId}`,
    ).rejects.toThrow(/append-only/);
  });
});

describe("projections", () => {
  test("snapshot round-trips JSON state and up_to_seq", async () => {
    const state = {
      form: {
        id: "lesser-slime",
        vitals: { cohesion: 8, essence: 5 },
        stats: { density: 1, viscosity: -1, awareness: 0, will: 0 },
        state: {},
      },
      location: {
        id: "collapsed-tunnel",
        roomId: "seam-of-the-collapse",
        discovered: ["seam-of-the-collapse"],
      },
      inventory: [],
      npcs: {},
      quest: { id: "survive-the-night", objectives: {} },
      xp: 0,
      turn: 0,
      status: "active",
    };
    await db.insert(projections).values({ sessionId, upToSeq: 5, state });

    const [row] = await db
      .select()
      .from(projections)
      .where(eq(projections.sessionId, sessionId));
    expect(row.upToSeq).toBe(5);
    expect(row.state).toEqual(state);
  });
});

describe("entities", () => {
  test("insert and read back with enum kind", async () => {
    const id = uuidv7();
    await db.insert(entities).values({
      id,
      sessionId,
      kind: "npc",
      slug: "tunnel-rat-1",
      data: { templateId: "tunnel-rat", attitude: -1 },
    });
    const [row] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, id));
    expect(row.kind).toBe("npc");
    expect(row.slug).toBe("tunnel-rat-1");
    expect(row.data).toEqual({ templateId: "tunnel-rat", attitude: -1 });
  });

  test("(session_id, kind, slug) is unique", async () => {
    const base = {
      sessionId,
      kind: "npc" as const,
      slug: "dup",
      data: {},
    };
    await db.insert(entities).values({ id: uuidv7(), ...base });
    await expect(
      db.insert(entities).values({ id: uuidv7(), ...base }),
    ).rejects.toThrow();
  });
});

describe("memories", () => {
  test("int4range round-trips half-open; embedding may be null", async () => {
    const id = uuidv7();
    await db.insert(memories).values({
      id,
      sessionId,
      summary: "First taste of iron in the dark",
      eventSeqRange: [1, 4],
      salience: 0.7,
    });
    const [row] = await db.select().from(memories).where(eq(memories.id, id));
    expect(row.summary).toBe("First taste of iron in the dark");
    expect(row.eventSeqRange).toEqual([1, 4]);
    expect(row.salience).toBeCloseTo(0.7, 5);
    expect(row.embedding).toBeNull();
  });
});

describe("templates (seeded)", () => {
  test("lesser-slime form is present with verbs and negativeVocab", async () => {
    const [row] = await db
      .select()
      .from(templatesForms)
      .where(eq(templatesForms.id, "lesser-slime"));
    expect(row).toBeDefined();
    expect(row.version).toBe(1);
    const data = row.data as {
      verbs: string[];
      negativeVocab: { words: string[] };
    };
    expect(data.verbs).toContain("absorb");
    expect(data.negativeVocab.words).toContain("hand");
    expect(data.negativeVocab.words).toContain("see");
  });

  test("collapsed-tunnel location is present with rooms", async () => {
    const [row] = await db
      .select()
      .from(templatesLocations)
      .where(eq(templatesLocations.id, "collapsed-tunnel"));
    expect(row).toBeDefined();
    const data = row.data as {
      entryRoomId: string;
      rooms: Array<{ id: string; exits: unknown[] }>;
    };
    expect(data.entryRoomId).toBe("seam-of-the-collapse");
    expect(data.rooms.length).toBeGreaterThanOrEqual(5);
    expect(data.rooms.find((r) => r.id === "seam-of-the-collapse")).toBeDefined();
  });
});
