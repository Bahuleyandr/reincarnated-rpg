/**
 * 2d6 PbtA resolution + form-specific dice variants (Phase 9).
 *
 *   10+    success
 *   7-9    partial (success with cost; narrator MUST pick a hard-move)
 *   6-     miss    (failure; narrator makes a hard-move; tools reflect cost)
 *
 * Form-specific variants share the same band thresholds so all the
 * downstream code (hard-move menus, tool resolution) works
 * unchanged. They differ only in the SHAPE of the underlying dice
 * — different forms feel different to play because their dice have
 * different floors, ceilings, and variances:
 *
 *   - "2d6"     (default): mean 7, range 2-12. The PbtA baseline.
 *   - "3d6kh2"  (cursed-book): roll 3d6, keep 2 highest. Patient,
 *                methodical: high floor (~5), still hits 12. Fewer
 *                dramatic misses — the book chooses what to reveal.
 *   - "2d6r1"   (dragon-egg): 2d6 with one-shot reroll of any 1s.
 *                Lifts the floor from 2 to 4 mean-shifted upward.
 *                Reflects the egg's "lucky if you survive" feel.
 *   - "1d12"    (dungeon-core): a single d12 (uniform 1-12). Wide
 *                variance, swingy. The core's signature plays
 *                either land big or fizzle; nothing in the middle.
 *
 * Modifier range is -2..+3 from form stats; situational modifiers
 * cap at ±2 and must be justified by event-log state. The roll
 * engine here doesn't enforce that — it's trustfully applied at
 * the caller; the stat selection happens in the verb→tool mapping
 * (see slime form `verbMappings`).
 */
import { mulberry32, rollDie } from "../util/rng";

import type { RollBand, RollResult } from "./types";

export const PARTIAL_THRESHOLD = 7;
export const SUCCESS_THRESHOLD = 10;

export type DiceVariant = "2d6" | "3d6kh2" | "2d6r1" | "1d12";

/** All known dice-variant ids. Used by tests + admin tooling. */
export const DICE_VARIANTS: DiceVariant[] = [
  "2d6",
  "3d6kh2",
  "2d6r1",
  "1d12",
];

/**
 * The legacy entry point — defaults to 2d6. Existing callers don't
 * have to change. Form-aware code calls `rollDice(variant, ...)`.
 */
export function roll2d6(seed: number, mod = 0): RollResult {
  return rollDice("2d6", seed, mod);
}

/**
 * Roll the form's configured dice variant. Returns a uniform
 * RollResult shape regardless of which variant was rolled — d1/d2
 * carry "the two dice the UI should show" (for 3d6kh2 these are
 * the two kept dice; for 1d12 d1 is the single die and d2 is 0).
 * `total` is post-mod; `band` is computed from total. The
 * variant id rides on `variant` so the UI / narrator can flavor.
 */
export function rollDice(
  variant: DiceVariant,
  seed: number,
  mod = 0,
): RollResult {
  const rng = mulberry32(seed);
  switch (variant) {
    case "2d6": {
      const d1 = rollDie(rng);
      const d2 = rollDie(rng);
      const total = d1 + d2 + mod;
      return { d1, d2, mod, total, band: bandFor(total), seed, variant };
    }
    case "3d6kh2": {
      // Roll 3d6, keep 2 highest. Patient + deliberate.
      const all = [rollDie(rng), rollDie(rng), rollDie(rng)].sort(
        (a, b) => b - a,
      );
      const d1 = all[0];
      const d2 = all[1];
      const total = d1 + d2 + mod;
      return { d1, d2, mod, total, band: bandFor(total), seed, variant };
    }
    case "2d6r1": {
      // 2d6, one-shot reroll on any 1s. Slight upward bias.
      let d1 = rollDie(rng);
      if (d1 === 1) d1 = rollDie(rng);
      let d2 = rollDie(rng);
      if (d2 === 1) d2 = rollDie(rng);
      const total = d1 + d2 + mod;
      return { d1, d2, mod, total, band: bandFor(total), seed, variant };
    }
    case "1d12": {
      // Single d12. Swingy — high variance, no central tendency.
      const v = rollDie(rng, 12);
      const total = v + mod;
      return {
        d1: v,
        d2: 0,
        mod,
        total,
        band: bandFor(total),
        seed,
        variant,
      };
    }
  }
}

export function bandFor(total: number): RollBand {
  if (total >= SUCCESS_THRESHOLD) return "success";
  if (total >= PARTIAL_THRESHOLD) return "partial";
  return "miss";
}

/**
 * Test/eval helper: synthesize a RollResult from explicit dice values,
 * skipping the PRNG. Used by `eval/scenarios/*.rollOverride`.
 *
 * Always reports variant="2d6" since it's the harness for fixture
 * roll values that pre-date variants. Callers wanting variant-aware
 * fixtures can construct RollResult directly.
 */
export function rollFromDice(d1: number, d2: number, mod = 0): RollResult {
  if (d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6) {
    throw new Error(`d1/d2 must be 1..6 (got ${d1}, ${d2})`);
  }
  const total = d1 + d2 + mod;
  return {
    d1,
    d2,
    mod,
    total,
    band: bandFor(total),
    seed: 0,
    variant: "2d6",
  };
}
