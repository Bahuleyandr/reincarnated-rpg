/**
 * Per-user monthly image generation caps. Pure month-key math
 * mirrors the one-shot grant pattern from Phase 1 Day 6 (objectives
 * use period_key); when the user's month_key changes from a
 * previous setting, their monthly_count resets.
 *
 * Caps are tier-aware:
 *   free       → 0 images (the toggle exists but generation is
 *                blocked; sets clear expectation)
 *   supporter  → 50 / month
 *   patron     → 250 / month
 *
 * The cap is enforced at the call site (preflight check before the
 * provider call). A blocked attempt writes a status='skipped' row
 * so we can show "monthly cap reached, upgrades at /settings".
 */
export const SCENE_IMAGE_FREE_CAP = 0;
export const SCENE_IMAGE_SUPPORTER_CAP = 50;
export const SCENE_IMAGE_PATRON_CAP = 250;

export type Tier = "free" | "supporter" | "patron";

export function capForTier(tier: string): number {
  if (tier === "patron") return SCENE_IMAGE_PATRON_CAP;
  if (tier === "supporter") return SCENE_IMAGE_SUPPORTER_CAP;
  return SCENE_IMAGE_FREE_CAP;
}

/** UTC year-month key, "YYYY-MM". */
export function monthKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export interface UserBudget {
  enabled: string; // 'true' | 'false'
  count: number;
  monthKey: string | null;
  tier: string;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason: "ok" | "disabled" | "tier_zero" | "monthly_cap";
  cap: number;
  used: number;
  resetCount: boolean;
}

/**
 * Pure preflight: does the user have budget for one more image?
 * Returns whether we should reset the count to 0 (when the
 * month rolled over) so the caller can persist that.
 */
export function checkBudget(
  user: UserBudget,
  now: Date = new Date(),
): BudgetCheckResult {
  const cap = capForTier(user.tier);
  const currentMonth = monthKey(now);
  const resetCount = user.monthKey !== currentMonth;
  const used = resetCount ? 0 : user.count;

  if (user.enabled !== "true") {
    return { allowed: false, reason: "disabled", cap, used, resetCount };
  }
  if (cap === 0) {
    return { allowed: false, reason: "tier_zero", cap, used, resetCount };
  }
  if (used >= cap) {
    return { allowed: false, reason: "monthly_cap", cap, used, resetCount };
  }
  return { allowed: true, reason: "ok", cap, used, resetCount };
}
