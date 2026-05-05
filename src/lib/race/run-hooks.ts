/**
 * Race mechanics — in-run hooks (T3.2 follow-up).
 *
 * Each race has a small ongoing mechanical effect on top of its
 * starter buff (see lib/race/mechanics.ts). These run inside
 * runTurn at roll-mod computation time.
 *
 * Per-race in-run rules:
 *   - human:    no mechanical hook (their thing is non-mechanical
 *               by design — succession-anxiety lives in the prose
 *               via narratorHint).
 *   - elven:    +1 to verbs that classify as social (trade,
 *               sense-room, observe). Reflects ledger-mind.
 *   - dwarven:  -1 in enclosed rooms (sky-bound discomfort).
 *               +1 in open-air rooms (orchard, fen, etc.).
 *   - halfling: +1 on naval verbs (sail, swim, dive, navigate)
 *               and at coastal locations.
 *   - orcish:   +1 on read/sense/decode verbs (writing-priority).
 *
 * The implementation is content-tag-light: we pattern-match
 * intent strings and locationId/roomId substrings rather than
 * adding tags to every location file. Cheap and reasonable; the
 * room-tag refactor can come later if/when the rule set grows.
 */

export type RaceId =
  | "human"
  | "elven"
  | "dwarven"
  | "halfling"
  | "orcish"
  | null;

const ENCLOSED_LOCATIONS = new Set([
  "collapsed-tunnel",
]);
const ENCLOSED_ROOM_PATTERNS = ["spire-archive", "hush-room", "cellar"];

const OPEN_AIR_LOCATIONS = new Set([
  "highfield-ascending",
  "coldspoon",
  "three-notches",
  "drowned-orchard",
  "tallowfen",
  "furrowmouth",
]);

const COASTAL_LOCATIONS = new Set([
  "the-coral-anchorage",
  "briny-bell",
  "crab-by-crab",
  "saltgale",
  "mudmoth",
]);

const NAVAL_VERB_PATTERNS = [
  "sail",
  "swim",
  "dive",
  "navigate",
  "row",
  "anchor",
  "set-sail",
  "ship",
  "helm",
];

const SOCIAL_VERB_PATTERNS = [
  "trade",
  "speak",
  "observe",
  "haggle",
  "negotiate",
  "introduce",
];

const READ_VERB_PATTERNS = [
  "read",
  "decode",
  "sense",
  "listen",
  "absorb_word",
  "marginalia",
];

interface RoomLike {
  id: string;
}

interface LocationLike {
  id: string;
}

function matchesAny(s: string, patterns: string[]): boolean {
  const lower = s.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

export interface RaceRollContext {
  raceId: RaceId;
  intent: string;
  location: LocationLike;
  room: RoomLike;
}

export interface RaceRollEffect {
  delta: number;
  reason: string | null;
}

const ZERO: RaceRollEffect = { delta: 0, reason: null };

/**
 * Pure: compute the per-race +/- to the 2d6 mod for this turn.
 * Returns 0 + null reason when no rule applies.
 *
 * Caller (runTurn) sums this onto baseMod alongside luck and
 * adaptive-difficulty. Logged in the per-turn log under
 * `raceMod` so cost analytics can attribute it.
 */
export function applyRaceRollModifier(
  ctx: RaceRollContext,
): RaceRollEffect {
  if (!ctx.raceId) return ZERO;
  const intent = ctx.intent.toLowerCase();
  const locId = ctx.location.id;
  const roomId = ctx.room.id ?? "";

  if (ctx.raceId === "dwarven") {
    if (
      ENCLOSED_LOCATIONS.has(locId) ||
      matchesAny(roomId, ENCLOSED_ROOM_PATTERNS)
    ) {
      return { delta: -1, reason: "dwarven-enclosed" };
    }
    if (OPEN_AIR_LOCATIONS.has(locId)) {
      return { delta: 1, reason: "dwarven-open-air" };
    }
    return ZERO;
  }
  if (ctx.raceId === "halfling") {
    if (
      matchesAny(intent, NAVAL_VERB_PATTERNS) ||
      COASTAL_LOCATIONS.has(locId)
    ) {
      return { delta: 1, reason: "halfling-naval" };
    }
    return ZERO;
  }
  if (ctx.raceId === "orcish") {
    if (matchesAny(intent, READ_VERB_PATTERNS)) {
      return { delta: 1, reason: "orcish-read" };
    }
    return ZERO;
  }
  if (ctx.raceId === "elven") {
    if (matchesAny(intent, SOCIAL_VERB_PATTERNS)) {
      return { delta: 1, reason: "elven-ledger-mind" };
    }
    return ZERO;
  }
  // human: no in-run mod by design.
  return ZERO;
}
