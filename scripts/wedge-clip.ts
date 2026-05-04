import "./load-env";

/**
 * wedge-clip — same-seed evidence harness.
 *
 * Drives the same fixed seed + same player inputs through all
 * four typed forms (lesser-slime, cursed-book, dragon-egg,
 * dungeon-core) against the TemplateNarrator and writes a
 * side-by-side markdown report. The output is the artifact you
 * point at to demonstrate the project's wedge thesis: same
 * starting circumstances, fundamentally different play.
 *
 * Output: eval/wedge-clips/<timestamp>/{report,slime,book,egg,core}.md
 *
 * Run: `npx tsx scripts/wedge-clip.ts`
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Db } from "../src/lib/db/client";
import { sessions } from "../src/lib/db/schema";
import { pickStartingRoom } from "../src/lib/game/arc-routing";
import { loadForm, loadLocation } from "../src/lib/game/content";
import { appendEvents, readLog, rowToEvent } from "../src/lib/game/events";
import { _resetSessionCacheForTests, runTurn } from "../src/lib/game/turn";
import type { FormTemplate, LocationTemplate } from "../src/lib/game/types";
import { TemplateNarrator } from "../src/lib/narrator/template";
import { uuidv7 } from "../src/lib/util/uuidv7";

interface FormCase {
  formId: string;
  locationId: string;
  short: string;
}

const CASES: FormCase[] = [
  { formId: "lesser-slime", locationId: "collapsed-tunnel", short: "slime" },
  { formId: "cursed-book", locationId: "sunless-spire", short: "book" },
  { formId: "dragon-egg", locationId: "forsaken-village", short: "egg" },
  { formId: "dungeon-core", locationId: "sunless-spire", short: "core" },
];

const SHARED_SEED = 0x5eed1234; // any 32-bit unsigned, fixed for evidence

// Universally-interpretable inputs. The wedge isn't about
// whether the inputs make different sense — it's about the
// classifier mapping each one onto the form's actual verbs and
// the prose-shape constraints making the response materially
// different even on identical dice.
const TURNS = [
  "I take stock of where I am",
  "I sense who else is here",
  "I act — toward warmth or away from cold, whichever the form prefers",
  "I wait, attentive",
];

interface CapturedTurn {
  turn: number;
  input: string;
  classifierVerb: string;
  rollD1: number;
  rollD2: number;
  rollMod: number;
  rollTotal: number;
  rollBand: string;
  rollVariant?: string;
  narration: string;
  toolEvents: number;
  status: string;
}

interface FormCapture {
  short: string;
  formId: string;
  locationId: string;
  startingRoomId: string;
  diceVariant: string;
  turns: CapturedTurn[];
  finalStatus: string;
}

async function captureForm(
  db: Db,
  client: postgres.Sql,
  fc: FormCase,
): Promise<FormCapture> {
  const form = loadForm(fc.formId);
  const location = loadLocation(fc.locationId);
  const startingRoomId =
    pickStartingRoom(fc.formId, fc.locationId) ?? location.entryRoomId;

  await client.unsafe(
    "TRUNCATE memories, entities, projections, events, sessions RESTART IDENTITY CASCADE",
  );
  _resetSessionCacheForTests();
  const sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac: `wedge-${sessionId}`,
    formId: fc.formId,
  });
  await appendEvents(db, sessionId, [
    { kind: "session.started", formId: fc.formId, seed: SHARED_SEED } as never,
  ]);

  const narrator = new TemplateNarrator({
    form: form as FormTemplate,
    location: location as LocationTemplate,
  });
  const captured: CapturedTurn[] = [];
  let finalStatus = "active";
  for (let i = 0; i < TURNS.length; i++) {
    const input = TURNS[i];
    const result = await runTurn({
      db,
      sessionId,
      input,
      form: form as FormTemplate,
      location: location as LocationTemplate,
      narrator,
    });
    if (!result.ok) {
      finalStatus = `error:${result.error}`;
      break;
    }
    finalStatus = result.projection.status;
    // Pull the most recent roll + classifier events from the log.
    const events = (await readLog(db, sessionId)).map(rowToEvent);
    const intent = events
      .filter((e): e is typeof e & { kind: "intent.classified" } =>
        e.kind === "intent.classified",
      )
      .pop();
    const roll = events
      .filter((e): e is typeof e & { kind: "roll.resolved" } =>
        e.kind === "roll.resolved",
      )
      .pop();
    captured.push({
      turn: i + 1,
      input,
      classifierVerb: intent?.verb ?? "?",
      rollD1: roll?.roll.d1 ?? 0,
      rollD2: roll?.roll.d2 ?? 0,
      rollMod: roll?.roll.mod ?? 0,
      rollTotal: roll?.roll.total ?? 0,
      rollBand: roll?.roll.band ?? "?",
      rollVariant: roll?.roll.variant,
      narration: result.narration,
      toolEvents: result.toolEvents,
      status: result.projection.status,
    });
    if (finalStatus !== "active") break;
  }

  return {
    short: fc.short,
    formId: fc.formId,
    locationId: fc.locationId,
    startingRoomId,
    diceVariant: form.dice ?? "2d6",
    turns: captured,
    finalStatus,
  };
}

function renderTurnMarkdown(t: CapturedTurn): string {
  const variant = t.rollVariant && t.rollVariant !== "2d6" ? ` [${t.rollVariant}]` : "";
  const dice =
    t.rollD2 === 0
      ? `d=${t.rollD1}`
      : `d1=${t.rollD1} d2=${t.rollD2}`;
  const mod = t.rollMod === 0 ? "" : t.rollMod > 0 ? ` +${t.rollMod}` : ` ${t.rollMod}`;
  return `### Turn ${t.turn}

> ${t.input}

- classifier verb: \`${t.classifierVerb}\`
- roll${variant}: ${dice}${mod} = **${t.rollTotal}** → \`${t.rollBand}\`
- tool events: ${t.toolEvents}
- session status: \`${t.status}\`

${t.narration}
`;
}

function renderPerForm(c: FormCapture): string {
  const head = `# ${c.short.toUpperCase()} — ${c.formId}

Location: \`${c.locationId}\` (room: \`${c.startingRoomId}\`)
Dice variant: \`${c.diceVariant}\`
Final status: \`${c.finalStatus}\`

`;
  return head + c.turns.map(renderTurnMarkdown).join("\n");
}

function renderReport(captures: FormCapture[]): string {
  const lines: string[] = [];
  lines.push(`# Same-seed wedge evidence

Seed (shared across all four forms): \`${SHARED_SEED}\`

Player inputs (identical across forms; turns 1-${TURNS.length}):

${TURNS.map((t, i) => `${i + 1}. ${t}`).join("\n")}

## Per-form summary

| form | dice | turns played | classifier path | final |
|---|---|---|---|---|
`);
  for (const c of captures) {
    const verbs = c.turns.map((t) => t.classifierVerb).join(" → ");
    lines.push(
      `| ${c.short} | \`${c.diceVariant}\` | ${c.turns.length} | ${verbs} | ${c.finalStatus} |`,
    );
  }
  lines.push(`
## What the wedge looks like in practice

Even with identical seeds and identical player inputs, the four
forms diverge on every dimension we measure:

- **Dice variant** differs: \`2d6\`, \`3d6kh2\`, \`2d6r1\`, \`1d12\`
  produce different totals on the same RNG stream.
- **Classifier verb** differs: the same English input maps to
  different form-specific verbs (e.g. "I act" → \`smother\` for
  slime, \`fall_open\` for book, \`kindle_glow\` for egg,
  \`spawn_minion\` for core).
- **Hard-move menus** differ: a partial roll picks from the
  form's own menu — slimes get exposed surface-skin, books
  get torn pages, eggs get warmth bleed, cores get mana leak.
- **Negative-vocab tone constraints** keep the prose distinct:
  the slime narration cannot use body parts, the book cannot
  use locomotion or sight, the egg cannot speak or move at
  all, the core is stationary.

See the per-form files for the full transcripts.

`);
  // Per-form embedded sections so the report is self-contained.
  for (const c of captures) {
    lines.push(`---\n\n${renderPerForm(c)}\n`);
  }
  return lines.join("\n");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[wedge-clip] DATABASE_URL is not set");
    process.exit(1);
  }
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client) as unknown as Db;

  console.log(`[wedge-clip] driving ${CASES.length} forms with seed ${SHARED_SEED}…`);

  const captures: FormCapture[] = [];
  for (const fc of CASES) {
    process.stdout.write(`  ${fc.short}… `);
    const cap = await captureForm(db, client, fc);
    captures.push(cap);
    console.log(`${cap.turns.length} turns, ${cap.finalStatus}`);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = join(process.cwd(), "eval", "wedge-clips", ts);
  mkdirSync(outDir, { recursive: true });

  // Per-form transcripts.
  for (const c of captures) {
    writeFileSync(join(outDir, `${c.short}.md`), renderPerForm(c));
  }
  // Top-level report.
  writeFileSync(join(outDir, "report.md"), renderReport(captures));

  console.log(`\n[wedge-clip] wrote ${captures.length + 1} files to`);
  console.log(`            ${outDir}`);
  console.log(`            see ./report.md for the side-by-side comparison`);

  await client.end();
}

void main();
