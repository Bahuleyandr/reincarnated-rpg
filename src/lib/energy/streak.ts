/**
 * Daily streak — the "Blessing of Returning Faith".
 *
 * The first turn each UTC day grants a one-shot energy bonus that
 * stacks with each consecutive-day login, capped at 5 days. Missing
 * a day resets to 1 (you log in today, count starts over).
 *
 *   day 1 streak  →  +1 energy
 *   day 2 streak  →  +2 energy
 *   day 3 streak  →  +3 energy
 *   day 4 streak  →  +4 energy
 *   day 5 streak  →  +5 energy   (capped here)
 *   sustained at 5: +5 every day for as long as they keep coming back
 *
 * 5-day climb total grant: 1+2+3+4+5 = 15 extra energy = 15 extra turns
 *
 * UTC date semantics: a "day" runs midnight UTC → next midnight UTC.
 * This is intentional global — the world's calendar, not the
 * player's local zone. Less code, less timezone drama, and lines up
 * with the meta-arc and lore-decay clocks (which also use UTC).
 *
 * The grant CAN exceed the tier max temporarily — it's a one-shot
 * gift. Regen still won't fire until energy drops below max via
 * spending; from there it tops up at the normal rate.
 */

export const MAX_STREAK = 5;

export interface StreakState {
  /** 0..5. */
  count: number;
  /** YYYY-MM-DD UTC string of the last day this player took a turn.
   *  Null until the very first turn. */
  lastDayUtc: string | null;
}

/** Format a Date as YYYY-MM-DD in UTC. Stable for comparison. */
export function utcDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** True iff `today` is exactly one UTC day after `prev`. */
export function isConsecutiveUtcDay(prev: string, today: string): boolean {
  const p = new Date(prev + "T00:00:00Z");
  const t = new Date(today + "T00:00:00Z");
  if (Number.isNaN(p.getTime()) || Number.isNaN(t.getTime())) return false;
  const diffMs = t.getTime() - p.getTime();
  // Exactly one day apart, allowing a 1-second skew window for DST/leap.
  return diffMs >= 24 * 60 * 60 * 1000 - 1000 &&
    diffMs <= 24 * 60 * 60 * 1000 + 1000;
}

export interface DailyGrant {
  /** Streak count BEFORE this grant. */
  streakBefore: number;
  /** Streak count AFTER this grant. Always >= 1. */
  streakAfter: number;
  /** Energy added (= streakAfter, capped at MAX_STREAK). */
  bonusEnergy: number;
  /** True when streakAfter == MAX_STREAK and streakBefore < MAX_STREAK
   *  — the moment the player completes the climb. UI can celebrate. */
  reachedCap: boolean;
}

export interface StreakResult {
  /** Updated streak state. */
  state: StreakState;
  /** When set, a daily grant was awarded; pass to the caller for the UI. */
  grant: DailyGrant | null;
}

/**
 * Pure function: given the last-known streak state and the current
 * date, decide whether this is the first turn of a new UTC day, and
 * if so, advance the streak + return the grant.
 *
 * Idempotent for a given UTC day — calling twice in the same day
 * returns no grant on the second call.
 */
export function claimDailyStreak(
  state: StreakState,
  now: Date,
): StreakResult {
  const today = utcDateString(now);
  if (state.lastDayUtc === today) {
    // Already claimed today.
    return { state, grant: null };
  }
  let nextCount: number;
  if (state.lastDayUtc && isConsecutiveUtcDay(state.lastDayUtc, today)) {
    nextCount = Math.min(MAX_STREAK, state.count + 1);
  } else {
    // First-ever or missed at least one day → reset to 1.
    nextCount = 1;
  }
  const bonus = nextCount; // grant scales with streak
  const reachedCap = nextCount === MAX_STREAK && state.count < MAX_STREAK;
  return {
    state: { count: nextCount, lastDayUtc: today },
    grant: {
      streakBefore: state.count,
      streakAfter: nextCount,
      bonusEnergy: bonus,
      reachedCap,
    },
  };
}
