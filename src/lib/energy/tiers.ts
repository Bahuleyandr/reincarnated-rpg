/**
 * Energy tier catalog.
 *
 * Each turn the player takes costs 1 energy. Energy refills
 * continuously up to the tier's max at the rate `regenIntervalMs`
 * per +1.
 *
 * Tier catalog is data — adding/changing tiers is a content-only
 * commit. The free tier is the default for new users; admins can
 * promote via /god/energy. Payment integration TBD; for v1 the
 * promotion path is admin-only.
 */

export interface Tier {
  /** Stable id used in users.tier. Lowercase, hyphenated. */
  id: string;
  /** Display label for UIs. */
  label: string;
  /** Max energy a player can hold. */
  max: number;
  /** Milliseconds between +1 regen ticks. */
  regenIntervalMs: number;
  /** One-line marketing copy for the upgrade panel. */
  description: string;
}

export const TIERS: Record<string, Tier> = {
  free: {
    id: "free",
    label: "Free",
    max: 20,
    regenIntervalMs: 45 * 60 * 1000, // 45 minutes
    description:
      "20 energy at a time, refilling 1 every 45 minutes (~32 turns/day).",
  },
  supporter: {
    id: "supporter",
    label: "Supporter",
    max: 60,
    regenIntervalMs: 20 * 60 * 1000, // 20 minutes
    description:
      "60 energy at a time, refilling 1 every 20 minutes (~72 turns/day).",
  },
  patron: {
    id: "patron",
    label: "Patron",
    max: 120,
    regenIntervalMs: 10 * 60 * 1000, // 10 minutes
    description:
      "120 energy at a time, refilling 1 every 10 minutes (~144 turns/day). Effectively unlimited for normal play.",
  },
};

export const DEFAULT_TIER_ID = "free";

export function getTier(id: string | null | undefined): Tier {
  return TIERS[id ?? DEFAULT_TIER_ID] ?? TIERS[DEFAULT_TIER_ID];
}

/** Approximate turns per 24h for a tier (regen-only, ignoring start
 *  cap). Exposed for the /settings UI. */
export function turnsPerDay(tier: Tier): number {
  return Math.floor((24 * 60 * 60 * 1000) / tier.regenIntervalMs);
}
