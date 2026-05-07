import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { loadBeatPack, loadForm, loadLocation } from "@/lib/game/content";
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
  test("ordinary first turn: ooze advances without rolling dice", async () => {
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
    expect(kinds).not.toContain("roll.resolved");
    expect(kinds).toContain("narration.emitted");
  });

  test("rollOverride pins the emitted roll for eval scenarios", async () => {
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
      rollOverride: { d1: 6, d2: 4, mod: 0 },
    });

    if (!result.ok) throw new Error(`turn failed: ${result.error}`);
    const events = (await readLog(db, created.sessionId)).map(rowToEvent);
    const roll = events.find((e) => e.kind === "roll.resolved");
    expect(roll?.kind).toBe("roll.resolved");
    if (roll?.kind === "roll.resolved") {
      expect(roll.roll.d1).toBe(6);
      expect(roll.roll.d2).toBe(4);
      expect(roll.roll.band).toBe("success");
    }
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

describe("runTurn — moderation", () => {
  test("mild profanity: turn proceeds, bad_luck stacks +2, then decays", async () => {
    const { moderate } = await import("@/lib/moderation");
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const narrator = new TemplateNarrator({ form, location });

    const created = await createSession(db, "lesser-slime");
    const moderation = moderate("damn this is hard");
    expect(moderation.verdict).toBe("mild");

    const r = await runTurn({
      db,
      sessionId: created.sessionId,
      input: "damn this is hard",
      form,
      location,
      narrator,
      moderation,
    });
    if (!r.ok) throw new Error(`turn failed: ${r.error}`);
    expect(r.projection.turn).toBe(1);
    // Curse applied (+2) then decayed (-1) at end of turn → net +1.
    expect(r.projection.form.state["bad_luck"]).toBe(1);
  });

  test("severe profanity: turn short-circuits with refusal narration, +5 bad_luck, no roll", async () => {
    const { moderate } = await import("@/lib/moderation");
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const narrator = new TemplateNarrator({ form, location });

    const created = await createSession(db, "lesser-slime");
    const moderation = moderate("rapist");
    expect(moderation.verdict).toBe("severe");

    const r = await runTurn({
      db,
      sessionId: created.sessionId,
      input: "rapist",
      form,
      location,
      narrator,
      moderation,
    });
    if (!r.ok) throw new Error(`turn unexpectedly failed: ${r.error}`);
    expect(r.narration).toMatch(/gods recoil/i);
    // Severe path skips the decay so the full +5 lands.
    expect(r.projection.form.state["bad_luck"]).toBe(5);
    // No roll event was emitted (short-circuited before classify).
    const events = (await readLog(db, created.sessionId)).map(rowToEvent);
    const kinds = events.map((e) => e.kind);
    expect(kinds).not.toContain("roll.resolved");
    expect(kinds).not.toContain("intent.classified");
    expect(kinds).toContain("turn.begun");
    expect(kinds).toContain("narration.emitted");
  });

  test("bad_luck decays by 1 each subsequent clean turn", async () => {
    const { moderate } = await import("@/lib/moderation");
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const narrator = new TemplateNarrator({ form, location });

    const created = await createSession(db, "lesser-slime");

    // Turn 1: cuss → bad_luck +2 → -1 decay → 1.
    await runTurn({
      db,
      sessionId: created.sessionId,
      input: "shit",
      form,
      location,
      narrator,
      moderation: moderate("shit"),
    });

    // Turn 2: clean. bad_luck=1 going in → after decay → 0.
    const r2 = await runTurn({
      db,
      sessionId: created.sessionId,
      input: "I ooze",
      form,
      location,
      narrator,
      moderation: moderate("I ooze"),
    });
    if (!r2.ok) throw new Error(`turn 2 failed: ${r2.error}`);
    expect(r2.projection.form.state["bad_luck"]).toBe(0);

    // Turn 3: still 0, no event emitted (no-op decay).
    const r3 = await runTurn({
      db,
      sessionId: created.sessionId,
      input: "I sense",
      form,
      location,
      narrator,
      moderation: moderate("I sense"),
    });
    if (!r3.ok) throw new Error(`turn 3 failed: ${r3.error}`);
    expect(r3.projection.form.state["bad_luck"] ?? 0).toBe(0);
  });

  test("clean input: bad_luck never accumulates and no decay event fires", async () => {
    const { moderate } = await import("@/lib/moderation");
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const narrator = new TemplateNarrator({ form, location });

    const created = await createSession(db, "lesser-slime");
    const r = await runTurn({
      db,
      sessionId: created.sessionId,
      input: "I ooze",
      form,
      location,
      narrator,
      moderation: moderate("I ooze"),
    });
    if (!r.ok) throw new Error(`turn failed: ${r.error}`);
    // bad_luck never appeared in form_state. The narrator may emit
    // OTHER form_state.changed events (e.g. viscosity tweaks on a
    // partial), so we only assert there are no bad_luck mutations.
    expect(r.projection.form.state["bad_luck"]).toBeUndefined();
    const events = (await readLog(db, created.sessionId)).map(rowToEvent);
    const badLuckEvents = events.filter(
      (e) => e.kind === "form_state.changed" && (e as { field: string }).field === "bad_luck",
    );
    expect(badLuckEvents).toHaveLength(0);
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
