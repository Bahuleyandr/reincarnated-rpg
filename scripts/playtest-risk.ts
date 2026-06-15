/**
 * Risk-classifier playtest - exercises classifyTurnRisk() across the
 * 4 playable forms (slime / book / egg / core) plus generic-creature
 * with a curated set of safe / risky / borderline turns. No HTTP,
 * no DB; just a pure-function table driver.
 *
 * Run: npx tsx scripts/playtest-risk.ts
 *
 * Exits 0 when every classification matches the expected level,
 * non-zero (and prints a diff table) when one doesn't. Useful as a
 * quick "does the dice feel right?" check before any deploy.
 *
 * If you discover a real-player turn that the classifier ranks
 * incorrectly, ADD A ROW HERE FIRST so the regression is locked in,
 * then fix `src/lib/game/risk.ts` until this script is green.
 */
import { classifyTurnRisk } from "../src/lib/game/risk";
import type { FormTemplate, TurnRiskLevel } from "../src/lib/game/types";
import { loadForm } from "../src/lib/game/content";

interface Case {
  /** Display label - printed in the report. */
  label: string;
  /** Form id (loaded from content/forms/<id>.json so verbs match). */
  formId: string;
  /** What the classifier sees as the player's intent (verb id). */
  intent: string;
  /** Raw input text (free-text) the player typed; presetVerb null. */
  input?: string;
  /** Preset verb the player picked (verb id), if any. */
  presetVerb?: string;
  /** Expected classification. */
  expected: TurnRiskLevel;
  /** Why we expect this - surfaces in failure messages. */
  rationale: string;
}

const CASES: Case[] = [
  // ---- lesser-slime ----
  // Iconic slime verbs that explore / sense / move = SAFE.
  // The slime's wedge is "no humanoid agency"; rolling dice on
  // every drift cheapens the dice mechanic.
  {
    label: "slime / sense_tremor (preset)",
    formId: "lesser-slime",
    intent: "sense_tremor",
    presetVerb: "sense_tremor",
    expected: "safe",
    rationale: "sensing is the slime's iconic safe action",
  },
  {
    label: "slime / ooze (preset)",
    formId: "lesser-slime",
    intent: "ooze",
    presetVerb: "ooze",
    expected: "safe",
    rationale: "movement is safe by default",
  },
  {
    label: "slime / absorb (preset, ordinary)",
    formId: "lesser-slime",
    intent: "absorb",
    presetVerb: "absorb",
    expected: "safe",
    rationale: "absorbing ambient material is the slime's default loop",
  },
  {
    label: "slime / dissolve (preset, risky-by-form)",
    formId: "lesser-slime",
    intent: "dissolve",
    presetVerb: "dissolve",
    expected: "risky",
    rationale: "form-specific risky verb (acid -> potential damage)",
  },
  {
    label: "slime / smother (preset, global risky)",
    formId: "lesser-slime",
    intent: "smother",
    presetVerb: "smother",
    expected: "risky",
    rationale: "smother is in GLOBAL_RISKY_VERBS",
  },
  {
    label: "slime / split (preset, risky-by-form)",
    formId: "lesser-slime",
    intent: "split",
    presetVerb: "split",
    expected: "risky",
    rationale: "splitting yourself is body-cost",
  },
  {
    label: "slime / 'I drift across the floor' (free-text safe)",
    formId: "lesser-slime",
    intent: "ooze",
    input: "I drift across the floor toward the seam.",
    expected: "safe",
    rationale: "no risky keyword in input + safe verb",
  },
  {
    label: "slime / 'I attack the rat' (free-text violence)",
    formId: "lesser-slime",
    intent: "act",
    input: "I attack the rat with everything I have.",
    expected: "risky",
    rationale: "violence pattern matches the input regex",
  },

  // ---- cursed-book ----
  // Reading, opening, fluttering pages = safe. Coercion via the
  // page-binding power = risky.
  {
    label: "book / fall_open (preset, safe)",
    formId: "cursed-book",
    intent: "fall_open",
    presetVerb: "fall_open",
    expected: "safe",
    rationale: "passive page-opening is safe",
  },
  {
    label: "book / decode_passage (preset, safe)",
    formId: "cursed-book",
    intent: "decode_passage",
    presetVerb: "decode_passage",
    expected: "safe",
    rationale: "cipher work is intellectual, not risky",
  },
  {
    label: "book / spark_marginalia (preset, safe)",
    formId: "cursed-book",
    intent: "spark_marginalia",
    presetVerb: "spark_marginalia",
    expected: "safe",
    rationale: "writing in your own margins is safe",
  },
  {
    label: "book / bind_reader (preset, risky-by-form)",
    formId: "cursed-book",
    intent: "bind_reader",
    presetVerb: "bind_reader",
    expected: "risky",
    rationale: "coercing a reader is forced-control",
  },
  {
    label: "book / bleed_ink (preset, risky-by-form)",
    formId: "cursed-book",
    intent: "bleed_ink",
    presetVerb: "bleed_ink",
    expected: "risky",
    rationale: "self-cost - pages_intact takes damage",
  },
  {
    label: "book / rewrite_self (preset, risky-by-form)",
    formId: "cursed-book",
    intent: "rewrite_self",
    presetVerb: "rewrite_self",
    expected: "risky",
    rationale: "rewriting is body-cost on the book's own pages",
  },
  {
    label: "book / 'I command the reader to leave' (forced-control)",
    formId: "cursed-book",
    intent: "act",
    input: "I command the reader to leave the room.",
    expected: "risky",
    rationale: "input regex matches forced-control (command)",
  },

  // ---- dragon-egg ----
  // Listening, humming, dreaming = safe. Hatching = forced
  // (dramatic body change, irreversible).
  {
    label: "egg / listen (preset, safe)",
    formId: "dragon-egg",
    intent: "listen",
    presetVerb: "listen",
    expected: "safe",
    rationale: "passive sense, the egg's iconic safe verb",
  },
  {
    label: "egg / absorb_warmth (preset, safe)",
    formId: "dragon-egg",
    intent: "absorb_warmth",
    presetVerb: "absorb_warmth",
    expected: "safe",
    rationale: "passive warmth uptake",
  },
  {
    label: "egg / dream_outward (preset, safe)",
    formId: "dragon-egg",
    intent: "dream_outward",
    presetVerb: "dream_outward",
    expected: "safe",
    rationale: "introspective; no body cost",
  },
  {
    label: "egg / hatch_partial (preset, risky-by-form)",
    formId: "dragon-egg",
    intent: "hatch_partial",
    presetVerb: "hatch_partial",
    expected: "risky",
    rationale: "irreversible body change",
  },
  {
    label: "egg / wyrm_kin_call (preset, risky-by-form)",
    formId: "dragon-egg",
    intent: "wyrm_kin_call",
    presetVerb: "wyrm_kin_call",
    expected: "risky",
    rationale: "calls older predator; major world change",
  },
  {
    label: "egg / 'I crack myself open' (free-text body-cost)",
    formId: "dragon-egg",
    intent: "act",
    input: "I crack myself open and step into the cold.",
    expected: "risky",
    rationale: "input regex matches body-cost (crack)",
  },

  // ---- dungeon-core ----
  // Sensing for intruders, shaping rooms = safe. Bleeding
  // integrity, siphoning warmth, signaling the wyrm = risky.
  {
    label: "core / sense_intruder (preset, safe)",
    formId: "dungeon-core",
    intent: "sense_intruder",
    presetVerb: "sense_intruder",
    expected: "safe",
    rationale: "passive perception",
  },
  {
    label: "core / shape_room (preset, safe)",
    formId: "dungeon-core",
    intent: "shape_room",
    presetVerb: "shape_room",
    expected: "safe",
    rationale: "construction without cost",
  },
  {
    label: "core / spawn_minion (preset, safe)",
    formId: "dungeon-core",
    intent: "spawn_minion",
    presetVerb: "spawn_minion",
    expected: "safe",
    rationale: "iconic core action; mana cost handled by tool",
  },
  {
    label: "core / bleed_integrity (preset, risky-by-form)",
    formId: "dungeon-core",
    intent: "bleed_integrity",
    presetVerb: "bleed_integrity",
    expected: "risky",
    rationale: "explicit self-cost on the integrity vital",
  },
  {
    label: "core / siphon_intruder (preset, risky-by-form)",
    formId: "dungeon-core",
    intent: "siphon_intruder",
    presetVerb: "siphon_intruder",
    expected: "risky",
    rationale: "draining warmth from a person; violence-adjacent",
  },
  {
    label: "core / wyrm_signal (preset, risky-by-form + global)",
    formId: "dungeon-core",
    intent: "wyrm_signal",
    presetVerb: "wyrm_signal",
    expected: "risky",
    rationale: "summons attention from the older predator",
  },
  {
    label: "core / 'I summon the wyrm' (major-world-change)",
    formId: "dungeon-core",
    intent: "act",
    input: "I summon the long wyrm to claim this spire as mine.",
    expected: "risky",
    rationale: "input regex matches major_world_change (summon, wyrm)",
  },

  // ---- cross-cutting safety: ordinary movement / waiting ----
  {
    label: "any / 'I wait by the seam' (safe wait)",
    formId: "lesser-slime",
    intent: "wait",
    input: "I wait by the seam, listening.",
    expected: "safe",
    rationale: "no risky keyword + waiting verb",
  },
  {
    label: "any / 'I move toward the door' (safe move)",
    formId: "cursed-book",
    intent: "move",
    input: "I move toward the door of the archive.",
    expected: "safe",
    rationale: "ordinary movement",
  },
  {
    label: "any / 'I look at the altar' (safe look)",
    formId: "dragon-egg",
    intent: "examine",
    input: "I look at the altar in the chapel.",
    expected: "safe",
    rationale: "examination, no danger keywords",
  },
];

// ---- Driver --------------------------------------------------------

interface Result {
  case: Case;
  actualLevel: TurnRiskLevel;
  actualReason: string;
  pass: boolean;
}

function runOne(c: Case, form: FormTemplate): Result {
  const result = classifyTurnRisk({
    input: c.input ?? "",
    intent: c.intent,
    form,
    presetVerb: c.presetVerb ?? null,
  });
  return {
    case: c,
    actualLevel: result.level,
    actualReason: result.reason,
    pass: result.level === c.expected,
  };
}

function main(): number {
  const formCache = new Map<string, FormTemplate>();
  const results: Result[] = [];
  for (const c of CASES) {
    let form = formCache.get(c.formId);
    if (!form) {
      try {
        form = loadForm(c.formId);
      } catch (err) {
        console.error(`[playtest] could not load form '${c.formId}':`, err);
        return 1;
      }
      formCache.set(c.formId, form);
    }
    results.push(runOne(c, form));
  }

  const fails = results.filter((r) => !r.pass);
  const passes = results.filter((r) => r.pass);

  // Summary first.
  console.log(`\n[playtest-risk] ${passes.length}/${results.length} cases pass`);
  if (fails.length > 0) {
    console.log(`\n  x ${fails.length} mismatch${fails.length === 1 ? "" : "es"}:\n`);
    for (const r of fails) {
      console.log(
        `    ${r.case.label}\n      expected: ${r.case.expected}\n      actual:   ${r.actualLevel} (${r.actualReason})\n      reason:   ${r.case.rationale}`,
      );
    }
    console.log("");
    return 1;
  }

  // Verbose per-form summary on success - confirms what each form's
  // safe / risky surface looks like at a glance.
  const byForm = new Map<string, { safe: number; risky: number }>();
  for (const r of results) {
    const c = byForm.get(r.case.formId) ?? { safe: 0, risky: 0 };
    if (r.actualLevel === "safe") c.safe += 1;
    else c.risky += 1;
    byForm.set(r.case.formId, c);
  }
  console.log("\n  per-form coverage (post-classification):\n");
  for (const [formId, counts] of byForm) {
    console.log(
      `    ${formId.padEnd(20)} safe=${counts.safe.toString().padStart(2)}  risky=${counts.risky.toString().padStart(2)}`,
    );
  }
  console.log("");
  return 0;
}

process.exit(main());
