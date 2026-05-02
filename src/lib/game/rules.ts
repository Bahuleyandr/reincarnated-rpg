/**
 * 2d6 PbtA resolution.
 *
 *   10+    success
 *   7-9    partial (success with cost; narrator MUST pick a hard-move)
 *   6-     miss    (failure; narrator makes a hard-move; tools reflect cost)
 *
 * Modifier range is -2..+3 from form stats; situational modifiers cap
 * at ±2 and must be justified by event-log state. The roll engine here
 * doesn't enforce that — it's trustfully applied at the caller; the
 * stat selection happens in the verb→tool mapping (see slime form
 * `verbMappings`). Day-4 scope: just the dice + bands.
 */
import { mulberry32, rollDie } from "../util/rng";

import type { RollBand, RollResult } from "./types";

export const PARTIAL_THRESHOLD = 7;
export const SUCCESS_THRESHOLD = 10;

export function roll2d6(seed: number, mod = 0): RollResult {
  const rng = mulberry32(seed);
  const d1 = rollDie(rng);
  const d2 = rollDie(rng);
  const total = d1 + d2 + mod;
  return {
    d1,
    d2,
    mod,
    total,
    band: bandFor(total),
    seed,
  };
}

export function bandFor(total: number): RollBand {
  if (total >= SUCCESS_THRESHOLD) return "success";
  if (total >= PARTIAL_THRESHOLD) return "partial";
  return "miss";
}

/**
 * Test/eval helper: synthesize a RollResult from explicit dice values,
 * skipping the PRNG. Used by `eval/scenarios/*.rollOverride`.
 */
export function rollFromDice(d1: number, d2: number, mod = 0): RollResult {
  if (d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6) {
    throw new Error(`d1/d2 must be 1..6 (got ${d1}, ${d2})`);
  }
  const total = d1 + d2 + mod;
  return { d1, d2, mod, total, band: bandFor(total), seed: 0 };
}
