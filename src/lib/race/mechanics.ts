/**
 * Race-specific mechanics — Phase 9 T3.2.
 *
 * Each race gets:
 *   - A starter form-state buff that's stamped into projection on
 *     first init (alongside the catalog's starterBonus).
 *   - A narrator-prompt fragment surfaced as part of the
 *     regionFlavor block when the player has declared a race.
 *
 * The race itself comes from users.race (T6.1 column). Anon
 * sessions and undeclared users get the empty modifier.
 *
 * Per-race design (each subverts genre defaults):
 *   - human:    +1 will at start; brittle-specialist nudge.
 *   - elven:    +1 awareness; "the act" reminder.
 *   - dwarven:  +1 patience (new field) + +1 awareness;
 *               agoraphobic nudge (no enclosed-room comfort).
 *   - halfling: +1 agility; dawn-meal reminder.
 *   - orcish:   +1 awareness; writing-priority nudge.
 */

export type RaceId =
  | "human"
  | "elven"
  | "dwarven"
  | "halfling"
  | "orcish"
  | null;

export interface RaceModifier {
  raceId: RaceId;
  /** Form-state field bumps applied at projection-init time
   *  (similar shape to the catalog's starterBonus, but per-race). */
  starterFormState: Record<string, number>;
  /** A short narrator hint appended to the regionFlavor block.
   *  Empty string for null race. */
  narratorHint: string;
  /** Localizable display label for /character + /world/races. */
  label: string;
}

const MODIFIERS: Record<Exclude<RaceId, null>, RaceModifier> = {
  human: {
    raceId: "human",
    starterFormState: { will: 1 },
    narratorHint:
      "the player is human — brittle specialist, raised to one craft, time-pressured. weave succession-anxiety into NPC reactions when natural.",
    label: "Human",
  },
  elven: {
    raceId: "elven",
    starterFormState: { awareness: 1 },
    narratorHint:
      "the player is elven — they read the act on other elves and may drop it themselves in private. ledger-mind tracks every favor; the prose can mark when an elven NPC has logged a debt.",
    label: "Elven",
  },
  dwarven: {
    raceId: "dwarven",
    starterFormState: { awareness: 1, patience: 1 },
    narratorHint:
      "the player is dwarven — tall, sky-bound, agoraphobic toward enclosed spaces. low ceilings produce visible distress; the prose should foreground it. wood-and-bone tools preferred over metal.",
    label: "Dwarven",
  },
  halfling: {
    raceId: "halfling",
    starterFormState: { agility: 1 },
    narratorHint:
      "the player is halfling — wiry, salt-cured, eats once at dawn. midday eating is a sign of weakness in their culture; foreigners who snack are quietly judged in halfling company.",
    label: "Halfling",
  },
  orcish: {
    raceId: "orcish",
    starterFormState: { awareness: 1 },
    narratorHint:
      "the player is orcish — quiet philosopher. prefers writing to speaking; oaths must be written and countersigned in marginalia. violence is treated as a category error (defended against with reluctance).",
    label: "Orcish",
  },
};

const EMPTY_MODIFIER: RaceModifier = {
  raceId: null,
  starterFormState: {},
  narratorHint: "",
  label: "(none)",
};

export function raceModifier(raceId: string | null | undefined): RaceModifier {
  if (!raceId) return EMPTY_MODIFIER;
  return MODIFIERS[raceId as Exclude<RaceId, null>] ?? EMPTY_MODIFIER;
}

/**
 * Merge per-race starter buffs onto an existing starter form-state
 * map (from the catalog's starterBonus, the form template's
 * starting state, etc.). Race buffs ADD; they don't override.
 */
export function applyRaceStarter(
  base: Record<string, number>,
  raceId: string | null | undefined,
): Record<string, number> {
  const mod = raceModifier(raceId);
  const out: Record<string, number> = { ...base };
  for (const [k, v] of Object.entries(mod.starterFormState)) {
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

export const RACE_IDS: Array<Exclude<RaceId, null>> = [
  "human",
  "elven",
  "dwarven",
  "halfling",
  "orcish",
];
