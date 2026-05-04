/**
 * Wonder events (Phase 4.5 Day 17). Per-turn 1% chance to fire a
 * single wonder. Wonders are pure narration injection — small
 * unsolicited moments of "what was that?" texture. Some carry an
 * optionalToolEffect (e.g., a scroll falling = add_inventory).
 *
 * Selection is deterministic per (sessionId, turnNumber) so:
 *   - Tests can pin exact behavior with a fixed seed.
 *   - Re-running a turn deterministically (replay) produces the
 *     same wonder.
 *
 * Cooldown: per-wonder-id, 10 turns. Prevents the same wonder from
 * firing twice in a tight window. Tracked by passing the recent
 * wonder log into pickWonder.
 *
 * Filters:
 *   - formFilters: only fires for these forms (or any form when null)
 *   - locationFilters: only fires in these locations
 */
import wondersData from "../../../content/wonders.json";

import { mulberry32 } from "../util/rng";

interface RawWonder {
  id: string;
  narrationFlavor: string;
  formFilters?: string[];
  locationFilters?: string[];
  optionalToolEffect?: {
    name: string;
    [key: string]: unknown;
  };
}

interface RawCatalog {
  wonders: RawWonder[];
}

const CATALOG: readonly RawWonder[] = (wondersData as unknown as RawCatalog).wonders;

export interface Wonder {
  id: string;
  narrationFlavor: string;
  formFilters: string[] | null;
  locationFilters: string[] | null;
  optionalToolEffect: RawWonder["optionalToolEffect"] | null;
}

const NORMALIZED: Wonder[] = CATALOG.map((w) => ({
  id: w.id,
  narrationFlavor: w.narrationFlavor,
  formFilters: w.formFilters && w.formFilters.length > 0 ? w.formFilters : null,
  locationFilters:
    w.locationFilters && w.locationFilters.length > 0 ? w.locationFilters : null,
  optionalToolEffect: w.optionalToolEffect ?? null,
}));

const COOLDOWN_TURNS = 10;
const FIRE_PROBABILITY = 0.01;

export interface PickInputs {
  /** Stable per-(session,turn) seed. The session's sessionSeed mixed
   *  with the turn number works well. */
  seed: number;
  /** Current form id (matches formFilters when set). */
  formId: string;
  /** Current location id (matches locationFilters when set). */
  locationId: string;
  /** Wonder ids that fired in the last `cooldownTurns` turns of
   *  this session (most-recent-first). Used to enforce per-id
   *  cooldown. */
  recentWonderIds: readonly string[];
  /** Probability override for tests (default FIRE_PROBABILITY). */
  fireProbability?: number;
}

/**
 * Pure: pick a wonder for this turn, or null. Returns null in two
 * cases:
 *   1. The 1% roll missed.
 *   2. The roll hit but no eligible wonder is available (every
 *      candidate is in cooldown or filtered out).
 */
export function pickWonder(inputs: PickInputs): Wonder | null {
  const rng = mulberry32(inputs.seed);
  const fireRoll = rng();
  const threshold = inputs.fireProbability ?? FIRE_PROBABILITY;
  if (fireRoll >= threshold) return null;

  // The caller is responsible for trimming recentWonderIds to the
  // cooldown window (we expose COOLDOWN_TURNS for that). Anything in
  // the list is in cooldown.
  const cooldownSet = new Set(inputs.recentWonderIds);

  // Filter eligibility: not in cooldown + form/location filters
  // pass.
  const eligible = NORMALIZED.filter((w) => {
    if (cooldownSet.has(w.id)) return false;
    if (w.formFilters && !w.formFilters.includes(inputs.formId)) return false;
    if (w.locationFilters && !w.locationFilters.includes(inputs.locationId)) return false;
    return true;
  });
  if (eligible.length === 0) return null;

  // Use the second roll to pick within eligible.
  const idx = Math.floor(rng() * eligible.length);
  return eligible[idx] ?? null;
}

/** Catalog accessors for tests + admin tooling. */
export function listWonders(): readonly Wonder[] {
  return NORMALIZED;
}

export function getWonder(id: string): Wonder | null {
  return NORMALIZED.find((w) => w.id === id) ?? null;
}

export const WONDER_COOLDOWN_TURNS = COOLDOWN_TURNS;
export const WONDER_FIRE_PROBABILITY = FIRE_PROBABILITY;
