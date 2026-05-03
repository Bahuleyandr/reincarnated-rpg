/**
 * Unified moderation gate for player input.
 *
 * Order of operations (cheapest first):
 *   1. Empty / oversize → "skip" (sanitize handled length already).
 *   2. Prompt-injection → "injection" (terminal — turn rejected).
 *   3. Severe profanity → "severe"   (terminal — turn rejected).
 *   4. Mild profanity   → "mild"     (turn proceeds; curse applied).
 *   5. Otherwise        → "clean"    (turn proceeds normally).
 *
 * The result carries:
 *  - `verdict`   — top-level severity bucket
 *  - `hits`      — every matched word/pattern (for audit + admin UI)
 *  - `badLuck`   — how many bad-luck stacks to add to form_state
 *  - `playerMessage` — what to show the player when terminal
 *  - `narratorFlavor` — short string the narrator can weave in for
 *    mild profanity (so the world reacts in-fiction)
 *
 * Pure function — no DB, no logging. Callers (turn route) record
 * outcomes via the event log.
 */
import { detectInjection, type InjectionHit } from "./injection";
import {
  detectProfanity,
  type ProfanityHit,
} from "./profanity";

export type ModerationVerdict = "clean" | "mild" | "severe" | "injection";

export interface ModerationOutcome {
  verdict: ModerationVerdict;
  /** Profanity hits — empty when verdict is clean / injection. */
  profanityHits: ProfanityHit[];
  /** Injection hits — non-empty only when verdict is "injection". */
  injectionHits: InjectionHit[];
  /** Bad-luck stacks to add via form_state.changed.bad_luck. */
  badLuck: number;
  /** Player-facing rejection message (for terminal verdicts). */
  playerMessage: string | null;
  /** Optional flavor string the narrator can use when verdict=mild
   *  to reflect the cussing in-fiction. Null for non-mild. */
  narratorFlavor: string | null;
}

/** Bad-luck stack added per profanity tier. Tuned so:
 *   mild (+2 stacks) → next 2 turns get -1 to roll modifier
 *   severe (+5 stacks) → next 5 turns blanketed in -2 modifier
 *  See `badLuckRollPenalty` in src/lib/game/rules.ts. */
export const BAD_LUCK_STACK = {
  mild: 2,
  severe: 5,
} as const;

/** Hard ceiling on accumulated bad_luck — caps the worst-case streak
 *  even if the player keeps cussing every turn. Mirrors SAFETY_CAPS. */
export const BAD_LUCK_MAX = 20;

const FLAVORS = [
  "the air sours, briefly.",
  "something distant clicks its tongue.",
  "an unseen ledger marks a tally.",
  "a draft that wasn't there before passes through.",
  "the room's small luck withdraws a little.",
];

/** Pure: choose a flavor deterministically based on the input length
 *  so retries land on the same flavor (no flicker). */
function chooseFlavor(input: string): string {
  if (FLAVORS.length === 0) return "";
  const idx = input.length % FLAVORS.length;
  return FLAVORS[idx]!;
}

export function moderate(input: string): ModerationOutcome {
  const empty = !input || input.trim().length === 0;
  if (empty) {
    return {
      verdict: "clean",
      profanityHits: [],
      injectionHits: [],
      badLuck: 0,
      playerMessage: null,
      narratorFlavor: null,
    };
  }

  const inj = detectInjection(input);
  if (inj.detected) {
    return {
      verdict: "injection",
      profanityHits: [],
      injectionHits: inj.hits,
      badLuck: 0,
      playerMessage:
        "the gods reject your invocation — the world will not be commanded.",
      narratorFlavor: null,
    };
  }

  const prof = detectProfanity(input);
  if (prof.severity === "severe") {
    return {
      verdict: "severe",
      profanityHits: prof.hits,
      injectionHits: [],
      badLuck: BAD_LUCK_STACK.severe,
      playerMessage:
        "the gods recoil from your tongue. your turn is forfeit, and ill-luck clings to you.",
      narratorFlavor: null,
    };
  }
  if (prof.severity === "mild") {
    return {
      verdict: "mild",
      profanityHits: prof.hits,
      injectionHits: [],
      badLuck: BAD_LUCK_STACK.mild,
      playerMessage: null,
      narratorFlavor: chooseFlavor(input),
    };
  }

  return {
    verdict: "clean",
    profanityHits: [],
    injectionHits: [],
    badLuck: 0,
    playerMessage: null,
    narratorFlavor: null,
  };
}

/** Returns the roll-modifier penalty given the player's current
 *  bad_luck stack. Capped at -2 so curses don't make success
 *  impossible. Pure — no side effects, no DB. */
export function badLuckRollPenalty(badLuck: number): number {
  if (!Number.isFinite(badLuck) || badLuck <= 0) return 0;
  return -Math.min(2, Math.floor(badLuck));
}
