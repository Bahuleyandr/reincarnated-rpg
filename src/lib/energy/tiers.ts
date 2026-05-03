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

/**
 * Blessing of the Gods — first-week generosity for the free tier.
 *
 * Applies ONLY to free-tier players within `durationMs` of their
 * account creation (or anon-session start). For the duration:
 *   - cap × 2  (20 → 40)
 *   - regen / 2.25  (45min → 20min)
 *
 * Net: free + blessing ≈ supporter tier. Week 1 the player feels
 * what paying gets them; on day 8 it snaps to baseline. Real lure.
 *
 * Pure-function: not stored anywhere. Computed from
 * users.createdAt or sessions.startedAt.
 */
export interface Blessing {
  id: string;
  label: string;
  description: string;
  capMultiplier: number;
  /** Regen speed multiplier — interval is divided by this. >1 = faster. */
  regenSpeedMultiplier: number;
  durationMs: number;
}

export const BLESSING_OF_THE_GODS: Blessing = {
  id: "blessing-of-the-gods",
  label: "Blessing of the Gods",
  description:
    "The gods are smiling on your first week. Your cap is doubled and the world refills you faster.",
  capMultiplier: 2,
  regenSpeedMultiplier: 2.25,
  durationMs: 7 * 24 * 60 * 60 * 1000,
};

export interface EffectiveTier {
  tier: Tier;
  blessing: Blessing | null;
  /** Wall-clock ms when the blessing expires. Null if not blessed. */
  blessingExpiresAtMs: number | null;
}

/**
 * Returns the tier the engine should USE, accounting for the
 * Blessing of the Gods on free-tier players within their first
 * 7 days.
 *
 * - Non-free tiers pass through unchanged (paid players don't need
 *   the lure).
 * - Free-tier players outside the blessing window pass through.
 * - Free-tier players inside the window get a tier with doubled
 *   cap and ~2.25× faster regen.
 */
export function effectiveTier(
  baseTier: Tier,
  accountCreatedAt: Date | null | undefined,
  now: number = Date.now(),
): EffectiveTier {
  if (baseTier.id !== "free" || !accountCreatedAt) {
    return { tier: baseTier, blessing: null, blessingExpiresAtMs: null };
  }
  const elapsed = now - accountCreatedAt.getTime();
  if (elapsed < 0 || elapsed >= BLESSING_OF_THE_GODS.durationMs) {
    return { tier: baseTier, blessing: null, blessingExpiresAtMs: null };
  }
  const blessed: Tier = {
    ...baseTier,
    max: Math.round(baseTier.max * BLESSING_OF_THE_GODS.capMultiplier),
    regenIntervalMs: Math.round(
      baseTier.regenIntervalMs / BLESSING_OF_THE_GODS.regenSpeedMultiplier,
    ),
  };
  return {
    tier: blessed,
    blessing: BLESSING_OF_THE_GODS,
    blessingExpiresAtMs:
      accountCreatedAt.getTime() + BLESSING_OF_THE_GODS.durationMs,
  };
}
