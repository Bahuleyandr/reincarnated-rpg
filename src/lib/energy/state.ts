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
 * Race condition: read→compute→write. With concurrent turns from one
 * player, a race could grant one extra turn — accepted; cost is
 * negligible. A future Postgres advisory-lock variant could harden
 * if needed.
 */
import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";
import { log } from "../util/log";

import { DEFAULT_TIER_ID, getTier, type Tier } from "./tiers";

export interface EnergyState {
  /** Current energy. */
  energy: number;
  /** Last refill/spend update. */
  lastUpdatedAt: Date;
  /** Tier id at the time of read. */
  tierId: string;
}

export interface EnergyView extends EnergyState {
  /** The Tier object resolved from tierId. */
  tier: Tier;
  /** Milliseconds until the next +1 tick (0 if at max or no tier). */
  nextRegenMs: number;
  /** Estimated time when energy reaches max. Null if at max. */
  fullAtMs: number | null;
}

/** Pure function: apply regen to a state given the active tier and a
 *  timestamp. Returns a new state — does NOT mutate the input. */
export function applyRegen(
  state: EnergyState,
  tier: Tier,
  now: number,
): EnergyState {
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

/** Build a view including derived display fields. */
export function viewState(state: EnergyState, tier: Tier, now: number): EnergyView {
  const refilled = applyRegen(state, tier, now);
  let nextRegenMs = 0;
  let fullAtMs: number | null = null;
  if (refilled.energy < tier.max) {
    const sinceLast = now - refilled.lastUpdatedAt.getTime();
    nextRegenMs = Math.max(0, tier.regenIntervalMs - sinceLast);
    const ticksToFull = tier.max - refilled.energy;
    fullAtMs = now + nextRegenMs + (ticksToFull - 1) * tier.regenIntervalMs;
  }
  return { ...refilled, tier, nextRegenMs, fullAtMs };
}

// ---- Persistence helpers ------------------------------------------

interface ReadOpts {
  /** Logged-in user. When set, reads from users.* and ignores
   *  sessionId for storage. */
  userId?: string | null;
  /** Anon session. Used when userId is not set. */
  sessionId?: string | null;
}

/** Read current state from DB (no refill applied). Returns null if
 *  neither userId nor sessionId hits. */
async function readRaw(db: Db, opts: ReadOpts): Promise<EnergyState | null> {
  if (opts.userId) {
    const rows = await db
      .select({
        energy: users.energy,
        energyUpdatedAt: users.energyUpdatedAt,
        tier: users.tier,
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
    };
  }
  if (opts.sessionId) {
    const rows = await db
      .select({
        energy: sessions.energy,
        energyUpdatedAt: sessions.energyUpdatedAt,
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
    };
  }
  return null;
}

async function writeRaw(
  db: Db,
  opts: ReadOpts,
  state: EnergyState,
): Promise<void> {
  if (opts.userId) {
    await db
      .update(users)
      .set({
        energy: state.energy,
        energyUpdatedAt: state.lastUpdatedAt,
        tier: state.tierId,
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
      })
      .where(eq(sessions.id, opts.sessionId));
    return;
  }
}

/** Public: returns the up-to-date view with regen applied AND
 *  persisted. Persistence here means callers don't have to remember
 *  to write the refill back. */
export async function getEnergyView(
  db: Db,
  opts: ReadOpts,
): Promise<EnergyView | null> {
  const raw = await readRaw(db, opts);
  if (!raw) return null;
  const tier = getTier(raw.tierId);
  const refilled = applyRegen(raw, tier, Date.now());
  if (
    refilled.energy !== raw.energy ||
    refilled.lastUpdatedAt.getTime() !== raw.lastUpdatedAt.getTime()
  ) {
    await writeRaw(db, opts, refilled);
  }
  return viewState(refilled, tier, Date.now());
}

/** Public: spend N energy. Applies regen first; if still short,
 *  returns ok:false with the post-refill state for UI surfacing. */
export async function trySpend(
  db: Db,
  opts: ReadOpts,
  amount = 1,
): Promise<{ ok: boolean; view: EnergyView | null }> {
  const raw = await readRaw(db, opts);
  if (!raw) return { ok: false, view: null };
  const tier = getTier(raw.tierId);
  const refilled = applyRegen(raw, tier, Date.now());
  if (refilled.energy < amount) {
    if (
      refilled.energy !== raw.energy ||
      refilled.lastUpdatedAt.getTime() !== raw.lastUpdatedAt.getTime()
    ) {
      await writeRaw(db, opts, refilled);
    }
    return { ok: false, view: viewState(refilled, tier, Date.now()) };
  }
  const next: EnergyState = {
    ...refilled,
    energy: refilled.energy - amount,
  };
  await writeRaw(db, opts, next);
  return { ok: true, view: viewState(next, tier, Date.now()) };
}

/** Admin override: set tier and/or refill to max. */
export async function adminSetEnergy(
  db: Db,
  userId: string,
  patch: { tier?: string; refillToMax?: boolean; setEnergy?: number },
): Promise<EnergyView | null> {
  const raw = await readRaw(db, { userId });
  if (!raw) return null;
  const newTierId = patch.tier ?? raw.tierId;
  const tier = getTier(newTierId);
  let energy = raw.energy;
  if (patch.refillToMax) energy = tier.max;
  else if (typeof patch.setEnergy === "number")
    energy = Math.max(0, Math.min(tier.max, patch.setEnergy));
  const next: EnergyState = {
    energy,
    lastUpdatedAt: new Date(),
    tierId: newTierId,
  };
  await writeRaw(db, { userId }, next);
  log.info("energy.admin_set", {
    userId,
    tier: newTierId,
    energy,
    refillToMax: !!patch.refillToMax,
  });
  return viewState(next, tier, Date.now());
}
