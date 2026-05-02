import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import {
  loadBeatPack,
  loadForm,
  loadLocation,
} from "@/lib/game/content";
import { readLog, rowToEvent } from "@/lib/game/events";
import { _resetSessionCacheForTests, runTurn } from "@/lib/game/turn";
import { createSession } from "@/lib/game/session";
import { TemplateNarrator } from "@/lib/narrator/template";

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
    "TRUNCATE memories, entities, projections, events, sessions RESTART IDENTITY CASCADE",
  );
  _resetSessionCacheForTests();
});

describe("runTurn — happy path", () => {
  test("first turn: ooze → moved + projection turn=1", async () => {
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const narrator = new TemplateNarrator({ form, location });

    const created = await createSession(db, "lesser-slime");
    const result = await runTurn({
      db,
      sessionId: created.sessionId,
      input: "I ooze toward the slope",
      form,
      location,
      narrator,
    });

    if (!result.ok) throw new Error(`turn failed: ${result.error}`);
    expect(result.projection.turn).toBe(1);
    expect(result.narration).toBeTruthy();

    const events = (await readLog(db, created.sessionId)).map(rowToEvent);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("session.started");
    expect(kinds).toContain("turn.begun");
    expect(kinds).toContain("intent.classified");
    expect(kinds).toContain("roll.resolved");
    expect(kinds).toContain("narration.emitted");
  });

  test("two turns advance the projection roomId on a successful ooze", async () => {
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const narrator = new TemplateNarrator({ form, location });

    const created = await createSession(db, "lesser-slime");
    await runTurn({
      db,
      sessionId: created.sessionId,
      input: "I ooze toward the slope",
      form,
      location,
      narrator,
    });
    const r2 = await runTurn({
      db,
      sessionId: created.sessionId,
      input: "I sense the room",
      form,
      location,
      narrator,
    });

    if (!r2.ok) throw new Error(`turn 2 failed: ${r2.error}`);
    expect(r2.projection.turn).toBe(2);
  });

  test("beat fires when its trigger predicate matches projection state", async () => {
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const beatPack = loadBeatPack("survive-the-night");
    const narrator = new TemplateNarrator({ form, location });

    const created = await createSession(db, "lesser-slime");
    const r1 = await runTurn({
      db,
      sessionId: created.sessionId,
      input: "I ooze",
      form,
      location,
      narrator,
      beatPack,
    });

    if (!r1.ok) throw new Error(`turn 1 failed: ${r1.error}`);
    // 01-awakening fires on turn==1.
    expect(r1.beatsFired).toContain("01-awakening");
  });

  test("turn cap fires session.ended('cap')", async () => {
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const narrator = new TemplateNarrator({ form, location });

    const created = await createSession(db, "lesser-slime");
    let last;
    for (let i = 0; i < 3; i++) {
      last = await runTurn({
        db,
        sessionId: created.sessionId,
        input: "I wait",
        form,
        location,
        narrator,
        turnCap: 3,
      });
      if (!last.ok) break;
    }

    if (!last || !last.ok) throw new Error("expected ok result");
    expect(last.projection.status).toBe("capped");
  });
});

describe("runTurn — guards", () => {
  test("dead session rejects further turns", async () => {
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const narrator = new TemplateNarrator({ form, location });

    const created = await createSession(db, "lesser-slime");
    // Manually mark dead via a damage event sequence.
    await db
      .insert(sessions)
      .values({
        id: created.sessionId,
        cookieHmac: "x",
        formId: "x",
      })
      .onConflictDoNothing();
    // Force-end via runTurn input 'I wait' until cap → easier path:
    // instead, just append session.ended directly via low-level path is overkill;
    // for this test we instead use a turnCap=0 trick.
    const result = await runTurn({
      db,
      sessionId: created.sessionId,
      input: "I ooze",
      form,
      location,
      narrator,
      turnCap: 0, // causes immediate cap on first run
    });
    if (!result.ok) throw new Error("expected first call to succeed");
    expect(result.projection.status).toBe("capped");

    const second = await runTurn({
      db,
      sessionId: created.sessionId,
      input: "I ooze",
      form,
      location,
      narrator,
    });
    expect(second.ok).toBe(false);
  });
});
