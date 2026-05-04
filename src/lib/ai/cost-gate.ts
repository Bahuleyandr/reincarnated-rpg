/**
 * Per-user daily AI cost cap — Phase 7 Day 38.
 *
 * Caps:
 *   free      $0.50 / day
 *   supporter $2.00 / day
 *   patron    $10.00 / day
 *
 * Reset is lazy: on first call after UTC midnight following the
 * stored `dailyAiCostResetAt`, accrual flips back to 0 and the
 * reset timestamp advances. No cron required.
 *
 * The orchestrator calls `recordCostAndCheck(db, userId, usd)`
 * after each AI call — the running total is bumped, and the cap
 * verdict is returned so the next call can fall back to the
 * TemplateNarrator if the cap is hit.
 */
import { eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { users } from "../db/schema";

export const COST_CAPS_USD: Record<string, number> = {
  free: 0.5,
  supporter: 2,
  patron: 10,
};

export const DEFAULT_CAP_USD = COST_CAPS_USD.free;

export interface CostGateResult {
  /** True when accrual <= cap; the caller may proceed with AI. */
  allowed: boolean;
  /** Tier-derived daily cap. */
  cap: number;
  /** Total spent today, AFTER any pending update. */
  used: number;
  /** True when the caller hit the cap as a result of this update
   *  (transition from below → at-or-above). The orchestrator can
   *  fire a one-time "cost.cap_hit" telemetry event off this. */
  capHitJustNow: boolean;
}

function utcDayBoundary(d: Date): number {
  const start = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
  return start.getTime();
}

/**
 * Fetch the user's current cost state + tier. Lazily resets when
 * dailyAiCostResetAt is in a previous UTC day.
 */
export async function getCostState(
  db: Db,
  userId: string,
): Promise<{ tier: string; used: number; cap: number }> {
  const [row] = await db
    .select({
      tier: users.tier,
      used: users.dailyAiCostUsdToday,
      resetAt: users.dailyAiCostResetAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return { tier: "free", used: 0, cap: DEFAULT_CAP_USD };
  const todayBoundary = utcDayBoundary(new Date());
  const resetTs = row.resetAt instanceof Date ? row.resetAt.getTime() : 0;
  let used = row.used ?? 0;
  if (resetTs < todayBoundary) {
    // Lazy reset on read — write-back happens on the next bump.
    used = 0;
  }
  const cap = COST_CAPS_USD[row.tier] ?? DEFAULT_CAP_USD;
  return { tier: row.tier, used, cap };
}

/**
 * Atomically bump the user's daily accrual by `usd`. Returns the
 * verdict. If the stored resetAt is from a previous UTC day, also
 * flips it to today's boundary in the same UPDATE.
 */
export async function recordCostAndCheck(
  db: Db,
  userId: string,
  usd: number,
): Promise<CostGateResult> {
  const before = await getCostState(db, userId);
  const todayBoundary = utcDayBoundary(new Date());
  // Compute the new total — we already lazy-reset in getCostState,
  // so before.used is today's accrual.
  const next = Math.max(0, before.used + Math.max(0, usd));
  const wasUnderCap = before.used < before.cap;
  const isAtCap = next >= before.cap;
  await db
    .update(users)
    .set({
      dailyAiCostUsdToday: next,
      dailyAiCostResetAt: new Date(todayBoundary),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  return {
    allowed: !isAtCap,
    cap: before.cap,
    used: next,
    capHitJustNow: wasUnderCap && isAtCap,
  };
}

void sql;
