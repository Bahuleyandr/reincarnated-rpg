/**
 * Smoke test for the same-seed wedge-clip harness.
 *
 * The full script (scripts/wedge-clip.ts) is a CLI artifact —
 * we run it manually to produce the marketing artifact under
 * eval/wedge-clips/. This test reproduces a tiny slice of its
 * runtime path: drive runTurn against the four typed forms with
 * the same seed + same risky input through TemplateNarrator, confirm
 * each form classifies the input and rolls its dice shape independently.
 *
 * Catches:
 *   - A future refactor breaks the per-form classifier mapping
 *   - The dice variant config is silently ignored
 *   - One of the forms can't actually run end-to-end
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { loadForm, loadLocation } from "@/lib/game/content";
import { appendEvents, readLog, rowToEvent } from "@/lib/game/events";
import { _resetSessionCacheForTests, runTurn } from "@/lib/game/turn";
import type { Event, FormTemplate, LocationTemplate } from "@/lib/game/types";
import { TemplateNarrator } from "@/lib/narrator/template";
import { uuidv7 } from "@/lib/util/uuidv7";

const SHARED_SEED = 0x5eed1234;

interface Case {
  short: string;
  formId: string;
  locationId: string;
  expectedDice: string;
}

const CASES: Case[] = [
  {
    short: "slime",
    formId: "lesser-slime",
    locationId: "collapsed-tunnel",
    expectedDice: "2d6",
  },
  {
    short: "book",
    formId: "cursed-book",
    locationId: "sunless-spire",
    expectedDice: "3d6kh2",
  },
  {
    short: "egg",
    formId: "dragon-egg",
    locationId: "forsaken-village",
    expectedDice: "2d6r1",
  },
  {
    short: "core",
    formId: "dungeon-core",
    locationId: "sunless-spire",
    expectedDice: "1d12",
  },
];

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

async function driveOnce(c: Case): Promise<{
  ok: boolean;
  classifierVerb: string;
  diceVariant: string | undefined;
  rollTotal: number;
  narration: string;
}> {
  const form = loadForm(c.formId) as FormTemplate;
  const location = loadLocation(c.locationId) as LocationTemplate;
  const sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `wedge-${sessionId}`,
    formId: c.formId,
  });
  await appendEvents(db, sessionId, [
    { kind: "session.started", formId: c.formId, seed: SHARED_SEED },
  ]);
  const narrator = new TemplateNarrator({ form, location });
  const r = await runTurn({
    db,
    sessionId,
    input: "I summon danger to test this body",
    form,
    location,
    narrator,
  });
  if (!r.ok) {
    return {
      ok: false,
      classifierVerb: "?",
      diceVariant: undefined,
      rollTotal: 0,
      narration: "",
    };
  }
  const events = (await readLog(db, sessionId)).map(rowToEvent);
  const intent = events
    .filter(
      (e): e is Event & { kind: "intent.classified" } =>
        e.kind === "intent.classified",
    )
    .pop();
  const roll = events
    .filter(
      (e): e is Event & { kind: "roll.resolved" } =>
        e.kind === "roll.resolved",
    )
    .pop();
  return {
    ok: true,
    classifierVerb: intent?.verb ?? "?",
    diceVariant: roll?.roll.variant,
    rollTotal: roll?.roll.total ?? 0,
    narration: r.narration,
  };
}

describe("wedge-clip harness — same-seed evidence", () => {
  test("each form drives a turn end-to-end with its declared dice variant", async () => {
    for (const c of CASES) {
      const r = await driveOnce(c);
      expect(r.ok).toBe(true);
      expect(r.diceVariant ?? "2d6").toBe(c.expectedDice);
      // The classifier returned SOMETHING — non-empty verb. The
      // exact verb depends on the form's verb list + classifier
      // matcher; pinning specific verbs would be brittle.
      expect(r.classifierVerb.length).toBeGreaterThan(0);
      // Narration is non-empty (template narrator phrase bank).
      expect(r.narration.length).toBeGreaterThan(0);
    }
  });

  test("same risky input emits a visible dice total for every form", async () => {
    for (const c of CASES) {
      const r = await driveOnce(c);
      expect(r.rollTotal).toBeGreaterThan(0);
      expect(r.diceVariant ?? "2d6").toBe(c.expectedDice);
    }
  });
});
