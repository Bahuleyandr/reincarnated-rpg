import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { sessions } from "@/lib/db/schema";
import { readLog, rowToEvent } from "@/lib/game/events";
import { initialProjection } from "@/lib/game/projection";
import { applyTools } from "@/lib/game/tools";
import type { FormTemplate, LocationTemplate, Projection } from "@/lib/game/types";
import { uuidv7 } from "@/lib/util/uuidv7";

const FORM: FormTemplate = {
  id: "lesser-slime",
  vitals: {
    cohesion: { max: 8, start: 8, death: 0 },
    essence: { max: 5, start: 5 },
  },
  stats: { density: 1, viscosity: -1, awareness: 0, will: 0 },
  verbs: ["absorb", "ooze"],
};

const LOC: LocationTemplate = {
  id: "collapsed-tunnel",
  entryRoomId: "seam",
  rooms: [
    { id: "seam", exits: [{ verb: "ooze", toRoomId: "slope" }] },
    { id: "slope", exits: [] },
  ],
};

let client: postgres.Sql;
let db: ReturnType<typeof drizzle>;
let sessionId: string;
let projection: Projection;

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
  projection = initialProjection({ sessionId, form: FORM, location: LOC });
});

describe("applyTools — happy path", () => {
  test("empty batch is a no-op", async () => {
    const result = await applyTools(db, sessionId, projection, []);
    expect(result).toEqual({ ok: true, events: [] });
  });

  test("single apply_damage tool produces a damage.applied event", async () => {
    const result = await applyTools(db, sessionId, projection, [
      {
        name: "apply_damage",
        target: "$SELF",
        amount: 2,
        source: "rat-bite",
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    const stored = await readLog(db, sessionId);
    const events = stored.map(rowToEvent);
    expect(events[0]).toEqual({
      kind: "damage.applied",
      target: "$SELF",
      amount: 2,
      source: "rat-bite",
    });
  });

  test("move_to threads the current projection's roomId into fromRoom", async () => {
    const result = await applyTools(db, sessionId, projection, [
      { name: "move_to", roomId: "slope" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const events = (await readLog(db, sessionId)).map(rowToEvent);
    expect(events[0]).toEqual({
      kind: "moved",
      fromRoom: "seam",
      toRoom: "slope",
    });
  });

  test("multi-tool batch produces all events in order", async () => {
    const result = await applyTools(db, sessionId, projection, [
      { name: "move_to", roomId: "slope" },
      { name: "pass_time", ticks: 1 },
      {
        name: "sense",
        modality: "vibration",
        detail: "drips",
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const events = (await readLog(db, sessionId)).map(rowToEvent);
    expect(events.map((e) => e.kind)).toEqual(["moved", "time.passed", "sensed"]);
  });

  test("narrate_only yields no event row", async () => {
    const result = await applyTools(db, sessionId, projection, [{ name: "narrate_only" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(0);
    const events = await readLog(db, sessionId);
    expect(events).toHaveLength(0);
  });
});

describe("applyTools — validation failures", () => {
  test("schema failure (negative amount) emits tool_validation_failed and rolls back", async () => {
    const result = await applyTools(db, sessionId, projection, [
      // valid tool first
      { name: "pass_time", ticks: 1 },
      // schema-invalid: amount must be >= 0
      {
        name: "apply_damage",
        target: "$SELF",
        amount: -3,
        source: "bug",
      } as never,
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.tool).toBe("apply_damage");
    const events = (await readLog(db, sessionId)).map(rowToEvent);
    // No pass_time should have been written; only the failure event.
    expect(events.map((e) => e.kind)).toEqual(["tool_validation_failed"]);
  });

  test("precondition failure (remove_inventory of unheld item) emits failure event", async () => {
    const result = await applyTools(db, sessionId, projection, [
      { name: "remove_inventory", itemId: "ghost-stone", qty: 1 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.tool).toBe("remove_inventory");
    expect(result.failure.error).toMatch(/not held/);
    const events = (await readLog(db, sessionId)).map(rowToEvent);
    expect(events.map((e) => e.kind)).toEqual(["tool_validation_failed"]);
  });

  test("precondition failure (apply_damage with unknown vital) is caught", async () => {
    const result = await applyTools(db, sessionId, projection, [
      {
        name: "apply_damage",
        target: "$SELF",
        amount: 1,
        source: "test",
        vital: "nonexistent",
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/no vital/);
  });

  test("precondition failure (update_relationship for unknown npc) is caught", async () => {
    const result = await applyTools(db, sessionId, projection, [
      {
        name: "update_relationship",
        npcId: "ghost",
        delta: 1,
        reason: "spectral",
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/unknown npc/);
  });
});
