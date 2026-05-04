/**
 * Energy state machine — pure functions over a {energy, lastUpdated}
 * pair plus the player's tier. Persistence is decoupled (the actor
 * functions in this module also handle DB read+write).
 *
 * Refill model:
 *   ticks = floor((now - lastUpdated) / regenInterval)
 *   newEnergy = min(max, energy + ticks)
 *   newLastUpdated = lastUpdated + ticks * regenInterval
 *
 * "Advance lastUpdated by exactly the ticks awarded" preserves the
 * partial-interval remainder. A player at energy=5 with
 * lastUpdated=T-50min (regenInterval=45min) gets +1 → energy=6,
 * lastUpdated=T-5min (so the next +1 is 40 minutes away, not 45).
 *
 * Mutating helpers take a transaction-scoped advisory lock so parallel
 * turn requests cannot both spend the same point of energy.
 */
import { eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";
import { log } from "../util/log";

import { DEFAULT_TIER_ID, effectiveTier, getTier, type Blessing, type Tier } from "./tiers";
import { claimDailyStreak, type DailyGrant, type StreakState } from "./streak";

export interface EnergyState {
  /** Current energy. */
  energy: number;
  /** Last refill/spend update. */
  lastUpdatedAt: Date;
  /** Tier id at the time of read. */
  tierId: string;
  /** When the player's account / anon session was created. Used to
   *  decide whether the Blessing of the Gods is active. Null only
   *  for legacy rows that pre-date the column. */
  accountCreatedAt: Date | null;
  /** Daily-streak state. Capped at 5; resets to 1 on missed day. */
  streak: StreakState;
}

export interface EnergyView extends EnergyState {
  /** The EFFECTIVE Tier object — already wrapped with any active
   *  blessing. The /api/turn gate spends against this. */
  tier: Tier;
  /** Milliseconds until the next +1 tick (0 if at max or no tier). */
  nextRegenMs: number;
  /** Estimated time when energy reaches max. Null if at max. */
  fullAtMs: number | null;
  /** Active blessing (Blessing of the Gods today; future blessings
   *  ride the same channel). Null when no blessing is active. */
  blessing: Blessing | null;
  /** Wall-clock ms when the blessing expires. Null if no blessing. */
  blessingExpiresAtMs: number | null;
  /** Set when the most recent state mutation (trySpend or
   *  getEnergyView) just claimed a daily streak grant. UI surfaces
   *  this as a "+N from Day-K streak" notification. Null otherwise. */
  dailyGrant: DailyGrant | null;
}

/** Pure function: apply regen to a state given the active tier and a
 *  timestamp. Returns a new state — does NOT mutate the input. */
export function applyRegen(state: EnergyState, tier: Tier, now: number): EnergyState {
  const lastMs = state.lastUpdatedAt.getTime();
  const elapsed = now - lastMs;
  if (elapsed <= 0) return state;
  const ticks = Math.floor(elapsed / tier.regenIntervalMs);
  if (ticks <= 0) return state;
  // If already at max, fast-forward lastUpdated so we don't accumulate
  // a refill "stash" — the player's next spend should still wait a
  // full interval before regen resumes.
  if (state.energy >= tier.max) {
    return { ...state, lastUpdatedAt: new Date(now) };
  }
  const newEnergy = Math.min(tier.max, state.energy + ticks);
  // Advance only by the ticks we actually awarded so partial intervals
  // carry forward (no "stash" loss).
  const advanced = ticks * tier.regenIntervalMs;
  return {
    ...state,
    energy: newEnergy,
    lastUpdatedAt: new Date(lastMs + advanced),
  };
}

/** Build a view including derived display fields.
 *
 *  `dailyGrant` should be passed when the caller just claimed a daily
 *  streak grant (trySpend / getEnergyView do this). Pure-function
 *  callers — tests and one-shot inspections — can omit it; null is
 *  the well-formed "no grant fired" value. */
export function viewState(
  state: EnergyState,
  tier: Tier,
  now: number,
  dailyGrant: DailyGrant | null = null,
): EnergyView {
  const refilled = applyRegen(state, tier, now);
  let nextRegenMs = 0;
  let fullAtMs: number | null = null;
  if (refilled.energy < tier.max) {
    const sinceLast = now - refilled.lastUpdatedAt.getTime();
    nextRegenMs = Math.max(0, tier.regenIntervalMs - sinceLast);
    const ticksToFull = tier.max - refilled.energy;
    fullAtMs = now + nextRegenMs + (ticksToFull - 1) * tier.regenIntervalMs;
  }
  // Resolve blessing presence + expiry from accountCreatedAt. The
  // tier passed in is already the EFFECTIVE tier (caller wraps with
  // effectiveTier). We re-derive to fill the blessing fields.
  const eff = effectiveTier(getTier(refilled.tierId), refilled.accountCreatedAt, now);
  return {
    ...refilled,
    tier,
    nextRegenMs,
    fullAtMs,
    blessing: eff.blessing,
    blessingExpiresAtMs: eff.blessingExpiresAtMs,
    dailyGrant,
  };
}

// ---- Persistence helpers ------------------------------------------

export interface ReadOpts {
  /** Logged-in user. When set, reads from users.* and ignores
   *  sessionId for storage. */
  userId?: string | null;
  /** Anon session. Used when userId is not set. */
  sessionId?: string | null;
}

/** Read current state from DB (no refill applied). Returns null if
 *  neither userId nor sessionId hits. Pulls accountCreatedAt
 *  (users.createdAt or sessions.startedAt) so blessing logic can
 *  decide whether the player is in their first week. Also pulls
 *  streak_count + streak_last_day_utc so the daily-grant logic has
 *  the previous day's anchor. */
async function readRaw(db: Db, opts: ReadOpts): Promise<EnergyState | null> {
  if (opts.userId) {
    const rows = await db
      .select({
        energy: users.energy,
        energyUpdatedAt: users.energyUpdatedAt,
        tier: users.tier,
        createdAt: users.createdAt,
        streakCount: users.streakCount,
        streakLastDayUtc: users.streakLastDayUtc,
      })
      .from(users)
      .where(eq(users.id, opts.userId))
      .limit(1);
    const u = rows[0];
    if (!u) return null;
    return {
      energy: u.energy,
      lastUpdatedAt: u.energyUpdatedAt,
      tierId: u.tier ?? DEFAULT_TIER_ID,
      accountCreatedAt: u.createdAt,
      streak: {
        count: u.streakCount,
        lastDayUtc: u.streakLastDayUtc,
      },
    };
  }
  if (opts.sessionId) {
    const rows = await db
      .select({
        energy: sessions.energy,
        energyUpdatedAt: sessions.energyUpdatedAt,
        startedAt: sessions.startedAt,
        streakCount: sessions.streakCount,
        streakLastDayUtc: sessions.streakLastDayUtc,
      })
      .from(sessions)
      .where(eq(sessions.id, opts.sessionId))
      .limit(1);
    const s = rows[0];
    if (!s) return null;
    return {
      energy: s.energy,
      lastUpdatedAt: s.energyUpdatedAt,
      tierId: DEFAULT_TIER_ID, // anon = free
      accountCreatedAt: s.startedAt,
      streak: {
        count: s.streakCount,
        lastDayUtc: s.streakLastDayUtc,
      },
    };
  }
  return null;
}

async function writeRaw(db: Db, opts: ReadOpts, state: EnergyState): Promise<void> {
  if (opts.userId) {
    await db
      .update(users)
      .set({
        energy: state.energy,
        energyUpdatedAt: state.lastUpdatedAt,
        tier: state.tierId,
        streakCount: state.streak.count,
        streakLastDayUtc: state.streak.lastDayUtc,
        updatedAt: new Date(),
      })
      .where(eq(users.id, opts.userId));
    return;
  }
  if (opts.sessionId) {
    await db
      .update(sessions)
      .set({
        energy: state.energy,
        energyUpdatedAt: state.lastUpdatedAt,
        streakCount: state.streak.count,
        streakLastDayUtc: state.streak.lastDayUtc,
      })
      .where(eq(sessions.id, opts.sessionId));
    return;
  }
}

async function withEnergyLock<T>(
  db: Db,
  opts: ReadOpts,
  fn: (lockedDb: Db) => Promise<T>,
): Promise<T> {
  const key = opts.userId ? `user:${opts.userId}` : `session:${opts.sessionId ?? "unknown"}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    return fn(tx as unknown as Db);
  });
}

/** Resolve the EFFECTIVE tier for a state — applies blessing logic.
 *  Single helper used by every public function so the rules stay
 *  consistent. */
function resolveTier(state: EnergyState, now: number): Tier {
  const base = getTier(state.tierId);
  return effectiveTier(base, state.accountCreatedAt, now).tier;
}

/** Apply the daily-streak claim to a freshly-read state. If a grant
 *  fires it adds `bonusEnergy` to the current energy (uncapped — it's
 *  a one-shot gift; player can briefly exceed tier.max) and advances
 *  the streak fields. Idempotent within a UTC day. Pure helper used
 *  by both getEnergyView and trySpend so they share semantics. */
function withDailyClaim(
  state: EnergyState,
  now: Date,
): { state: EnergyState; grant: DailyGrant | null } {
  const result = claimDailyStreak(state.streak, now);
  if (!result.grant) {
    return { state, grant: null };
  }
  return {
    state: {
      ...state,
      energy: state.energy + result.grant.bonusEnergy,
      streak: result.state,
    },
    grant: result.grant,
  };
}

/** Public: returns the up-to-date view with regen applied AND
 *  persisted. Also claims the daily-streak grant on the first call of
 *  a new UTC day — loading the page counts as "logging in", so the
 *  bonus arrives whether or not the player has spent a turn. */
export async function getEnergyView(db: Db, opts: ReadOpts): Promise<EnergyView | null> {
  return withEnergyLock(db, opts, async (lockedDb) => {
    const raw = await readRaw(lockedDb, opts);
    if (!raw) return null;
    const now = Date.now();
    const claimed = withDailyClaim(raw, new Date(now));
    const tier = resolveTier(claimed.state, now);
    const refilled = applyRegen(claimed.state, tier, now);
    const dirty =
      claimed.grant !== null ||
      refilled.energy !== raw.energy ||
      refilled.lastUpdatedAt.getTime() !== raw.lastUpdatedAt.getTime();
    if (dirty) {
      await writeRaw(lockedDb, opts, refilled);
    }
    return viewState(refilled, tier, now, claimed.grant);
  });
}

/** Public: spend N energy. Claims the daily streak first (so a
 *  brand-new player's first turn is funded by the +1 grant), then
 *  applies regen. If still short, returns ok:false with the
 *  post-refill state for UI surfacing. */
export async function trySpend(
  db: Db,
  opts: ReadOpts,
  amount = 1,
): Promise<{ ok: boolean; view: EnergyView | null }> {
  return withEnergyLock(db, opts, async (lockedDb) => {
    const raw = await readRaw(lockedDb, opts);
    if (!raw) return { ok: false, view: null };
    const now = Date.now();
    const claimed = withDailyClaim(raw, new Date(now));
    const tier = resolveTier(claimed.state, now);
    const refilled = applyRegen(claimed.state, tier, now);
    if (refilled.energy < amount) {
      const dirty =
        claimed.grant !== null ||
        refilled.energy !== raw.energy ||
        refilled.lastUpdatedAt.getTime() !== raw.lastUpdatedAt.getTime();
      if (dirty) {
        await writeRaw(lockedDb, opts, refilled);
      }
      return { ok: false, view: viewState(refilled, tier, now, claimed.grant) };
    }
    const next: EnergyState = {
      ...refilled,
      energy: refilled.energy - amount,
    };
    await writeRaw(lockedDb, opts, next);
    return { ok: true, view: viewState(next, tier, now, claimed.grant) };
  });
}

export async function refundEnergy(db: Db, opts: ReadOpts, amount = 1): Promise<EnergyView | null> {
  return withEnergyLock(db, opts, async (lockedDb) => {
    const raw = await readRaw(lockedDb, opts);
    if (!raw) return null;
    const now = Date.now();
    const tier = resolveTier(raw, now);
    const refilled = applyRegen(raw, tier, now);
    const next: EnergyState = {
      ...refilled,
      energy: Math.min(tier.max, refilled.energy + amount),
    };
    await writeRaw(lockedDb, opts, next);
    return viewState(next, tier, now);
  });
}

/** Admin override: set tier and/or refill to max. */
export async function adminSetEnergy(
  db: Db,
  userId: string,
  patch: { tier?: string; refillToMax?: boolean; setEnergy?: number },
): Promise<EnergyView | null> {
  const raw = await readRaw(db, { userId });
  if (!raw) return null;
  const now = Date.now();
  const newTierId = patch.tier ?? raw.tierId;
  // Resolve the EFFECTIVE tier under the new tier id (so admin
  // promoting a blessed-free user to supporter doesn't get them
  // the blessed-free max as the cap; they get supporter's 60 max).
  const tempState: EnergyState = { ...raw, tierId: newTierId };
  const tier = resolveTier(tempState, now);
  let energy = raw.energy;
  if (patch.refillToMax) energy = tier.max;
  else if (typeof patch.setEnergy === "number")
    energy = Math.max(0, Math.min(tier.max, patch.setEnergy));
  const next: EnergyState = {
    energy,
    lastUpdatedAt: new Date(),
    tierId: newTierId,
    accountCreatedAt: raw.accountCreatedAt,
    streak: raw.streak, // admin overrides don't touch the streak
  };
  await writeRaw(db, { userId }, next);
  log.info("energy.admin_set", {
    userId,
    tier: newTierId,
    energy,
    refillToMax: !!patch.refillToMax,
  });
  return viewState(next, tier, now);
}
