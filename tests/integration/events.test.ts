/**
 * Event-log integration: appendEvents (with seq guard) + readLog + rowToEvent.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { sessions } from "@/lib/db/schema";
import {
  appendEvents,
  readLog,
  rowToEvent,
  validateContiguous,
} from "@/lib/game/events";
import { uuidv7 } from "@/lib/util/uuidv7";
import type { Event } from "@/lib/game/types";

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
    cookieHmac: `t-${sessionId}`,
    formId: "lesser-slime",
  });
});

describe("appendEvents", () => {
  test("first batch starts at seq=1", async () => {
    const result = await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].seq).toBe(1);
  });

  test("multi-event batch assigns contiguous seqs", async () => {
    const result = await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "turn.begun", turn: 1, input: "x", inputSanitized: "x" },
      { kind: "moved", fromRoom: "seam", toRoom: "slope" },
    ]);
    expect(result.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  test("subsequent batch continues seq from previous max", async () => {
    await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "turn.begun", turn: 1, input: "x", inputSanitized: "x" },
    ]);
    const result2 = await appendEvents(db, sessionId, [
      { kind: "intent.classified", verb: "ooze", confidence: 0.8 },
    ]);
    expect(result2[0].seq).toBe(3);
  });

  test("session.started's top-level seed lands in the seed column", async () => {
    await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 42 },
    ]);
    const [row] = await readLog(db, sessionId);
    expect(row.seed).toBe(42);
    expect(row.payload).toEqual({ formId: "lesser-slime" });
  });

  test("roll.resolved leaves seed column null (roll.seed lives inside payload)", async () => {
    await appendEvents(db, sessionId, [
      {
        kind: "roll.resolved",
        roll: {
          d1: 4,
          d2: 3,
          mod: 0,
          total: 7,
          band: "partial",
          seed: 99,
        },
        against: "viscosity",
      },
    ]);
    const [row] = await readLog(db, sessionId);
    expect(row.seed).toBeNull();
    expect(
      (row.payload as { roll: { seed: number } }).roll.seed,
    ).toBe(99);
  });

  test("empty batch is a no-op", async () => {
    const result = await appendEvents(db, sessionId, []);
    expect(result).toEqual([]);
  });
});

describe("readLog", () => {
  test("returns rows in seq order", async () => {
    await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "turn.begun", turn: 1, input: "x", inputSanitized: "x" },
      { kind: "moved", fromRoom: "seam", toRoom: "slope" },
    ]);
    const rows = await readLog(db, sessionId);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.kind)).toEqual([
      "session.started",
      "turn.begun",
      "moved",
    ]);
  });

  test("fromSeq filters to seq > fromSeq", async () => {
    await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "turn.begun", turn: 1, input: "x", inputSanitized: "x" },
      { kind: "moved", fromRoom: "seam", toRoom: "slope" },
    ]);
    const rows = await readLog(db, sessionId, 1);
    expect(rows.map((r) => r.seq)).toEqual([2, 3]);
  });

  test("only returns events for the queried session", async () => {
    const other = uuidv7();
    await db.insert(sessions).values({
      id: other,
      cookieHmac: `t-${other}`,
      formId: "lesser-slime",
    });
    await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
    ]);
    await appendEvents(db, other, [
      { kind: "session.started", formId: "lesser-slime", seed: 2 },
      { kind: "turn.begun", turn: 1, input: "y", inputSanitized: "y" },
    ]);
    const rows = await readLog(db, sessionId);
    expect(rows).toHaveLength(1);
  });
});

describe("rowToEvent round-trip", () => {
  test("reconstructs a moved event verbatim", async () => {
    await appendEvents(db, sessionId, [
      { kind: "moved", fromRoom: "seam", toRoom: "slope" },
    ]);
    const [row] = await readLog(db, sessionId);
    const event = rowToEvent(row);
    expect(event).toEqual({
      kind: "moved",
      fromRoom: "seam",
      toRoom: "slope",
    });
  });

  test("reconstructs session.started with seed merged from the seed column", async () => {
    await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 42 },
    ]);
    const [row] = await readLog(db, sessionId);
    expect(rowToEvent(row)).toEqual({
      kind: "session.started",
      formId: "lesser-slime",
      seed: 42,
    });
  });

  test("a longer mixed log replays in original order with full payloads", async () => {
    const batch: Event[] = [
      { kind: "session.started", formId: "lesser-slime", seed: 7 },
      { kind: "turn.begun", turn: 1, input: "ooze", inputSanitized: "ooze" },
      { kind: "intent.classified", verb: "ooze", confidence: 0.9 },
      {
        kind: "roll.resolved",
        roll: {
          d1: 5,
          d2: 4,
          mod: -1,
          total: 8,
          band: "partial",
          seed: 7,
        },
        against: "viscosity",
      },
      { kind: "moved", fromRoom: "seam", toRoom: "slope" },
      {
        kind: "damage.applied",
        target: "$SELF",
        amount: 1,
        source: "scrape",
      },
    ];
    await appendEvents(db, sessionId, batch);
    const rows = await readLog(db, sessionId);
    const replay = rows.map(rowToEvent);
    expect(replay).toEqual(batch);
  });
});

describe("validateContiguous", () => {
  test("returns true for 1..N", async () => {
    await appendEvents(db, sessionId, [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "turn.begun", turn: 1, input: "x", inputSanitized: "x" },
      { kind: "moved", fromRoom: "seam", toRoom: "slope" },
    ]);
    const rows = await readLog(db, sessionId);
    expect(validateContiguous(rows)).toBe(true);
  });

  test("returns false for a synthetic gap", () => {
    const rows = [
      { seq: 1 } as never,
      { seq: 2 } as never,
      { seq: 4 } as never,
    ];
    expect(validateContiguous(rows)).toBe(false);
  });
});
