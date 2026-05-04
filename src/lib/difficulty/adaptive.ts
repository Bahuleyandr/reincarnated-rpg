/**
 * Adaptive difficulty — pure functions over a player's recent
 * campaign-end history. After 3 consecutive deaths, subsequent
 * runs get a small +1 to roll modifiers; first non-death (win or
 * cap) resets the streak.
 *
 * Capped at +1 — we want to soften the worst luck streaks, not
 * trivialize the dice. The mechanic is invisible to the narrator
 * (it just tweaks `mod` in roll2d6); the player sees it via a
 * subtle "the world is patient with you" line in the recap when
 * the modifier is active.
 */
export interface CampaignOutcome {
  reason: "death" | "win" | "cap" | "abandoned";
  endedAt: Date | null;
}

export interface AdaptiveResult {
  /** Number of consecutive recent deaths (uninterrupted by a win
   *  or cap). Capped at 5 for telemetry sanity. */
  deathStreak: number;
  /** Roll-modifier bonus to apply on subsequent turns. Currently
   *  +1 when deathStreak >= DEATH_STREAK_THRESHOLD, else 0. */
  modifier: number;
  /** True iff the bonus is active. Convenience flag for UIs. */
  active: boolean;
}

export const DEATH_STREAK_THRESHOLD = 3;
export const MAX_MODIFIER = 1;

/**
 * Walk the most-recent-first list of completed campaigns. Count
 * consecutive deaths from the head until a non-death or until we
 * exhaust the slice. Active campaigns (status='active' or no
 * endedAt) don't count — they haven't decided yet.
 */
export function computeAdaptiveDifficulty(
  recentCampaigns: readonly CampaignOutcome[],
): AdaptiveResult {
  let streak = 0;
  for (const c of recentCampaigns) {
    if (!c.endedAt) break; // unfinished — stop counting
    if (c.reason === "death") {
      streak += 1;
    } else {
      break; // first non-death resets
    }
    if (streak >= 5) break; // cap for telemetry
  }
  const modifier = streak >= DEATH_STREAK_THRESHOLD ? MAX_MODIFIER : 0;
  return {
    deathStreak: streak,
    modifier,
    active: modifier > 0,
  };
}
