/**
 * Craft credits — 0..10 pool of cheap craft actions before the next
 * energy spend. Each gather / smelt / smith / craft action calls
 * `consumeCraftCredit` once. When the pool has credits, decrement and
 * return `spentEnergy: false`. When empty, charge 1 energy via
 * `trySpend`, refill the pool to 10, decrement to 9, and return
 * `spentEnergy: true`. Out-of-energy: reject with the canonical
 * `out_of_energy_for_crafting` error.
 *
 * Net effect: 10 craft actions cost 1 energy. The player feels the
 * cost as a smooth gradient instead of a hard 1-energy gate per
 * action, while the existing energy system stays integer.
 *
 * Phase 5 Day 20.
 */
import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";
import { trySpend } from "../energy/state";

export interface CreditPurseRef {
  /** Set for logged-in players. */
  userId?: string;
  /** Set for anonymous sessions (when userId is undefined). */
  sessionId?: string;
}

export const MAX_CRAFT_CREDITS = 10;

export class OutOfEnergyForCraftingError extends Error {
  constructor() {
    super("out_of_energy_for_crafting");
    this.name = "OutOfEnergyForCraftingError";
  }
}

export async function getCraftCredits(
  db: Db,
  ref: CreditPurseRef,
): Promise<number> {
  if (ref.userId) {
    const [row] = await db
      .select({ credits: users.craftCredits })
      .from(users)
      .where(eq(users.id, ref.userId))
      .limit(1);
    return row?.credits ?? 0;
  }
  if (ref.sessionId) {
    const [row] = await db
      .select({ credits: sessions.craftCredits })
      .from(sessions)
      .where(eq(sessions.id, ref.sessionId))
      .limit(1);
    return row?.credits ?? 0;
  }
  return 0;
}

async function writeCraftCredits(
  db: Db,
  ref: CreditPurseRef,
  newValue: number,
): Promise<void> {
  if (ref.userId) {
    await db
      .update(users)
      .set({ craftCredits: newValue, updatedAt: new Date() })
      .where(eq(users.id, ref.userId));
    return;
  }
  if (ref.sessionId) {
    await db
      .update(sessions)
      .set({ craftCredits: newValue })
      .where(eq(sessions.id, ref.sessionId));
    return;
  }
  throw new Error("writeCraftCredits: must specify userId or sessionId");
}

export interface ConsumeResult {
  /** Pool size AFTER this consumption. 0..9. */
  remaining: number;
  /** True when this action triggered the energy-spend + refill. */
  spentEnergy: boolean;
}

/**
 * Atomic-ish: if the pool has credits, decrement and return. If
 * empty, spend 1 energy through trySpend (which has its own lock),
 * refill the pool to MAX_CRAFT_CREDITS, decrement to MAX-1, and
 * return spentEnergy=true. Throws OutOfEnergyForCraftingError if
 * trySpend can't charge.
 */
export async function consumeCraftCredit(
  db: Db,
  ref: CreditPurseRef,
): Promise<ConsumeResult> {
  const current = await getCraftCredits(db, ref);
  if (current > 0) {
    const next = current - 1;
    await writeCraftCredits(db, ref, next);
    return { remaining: next, spentEnergy: false };
  }

  // Pool empty — try to charge 1 energy. Convert to the energy
  // module's ReadOpts shape (it takes userId | null + sessionId).
  const trySpendRef = {
    userId: ref.userId ?? null,
    sessionId: ref.sessionId ?? "",
  };
  if (!trySpendRef.userId && !trySpendRef.sessionId) {
    throw new Error("consumeCraftCredit: must specify userId or sessionId");
  }
  const result = await trySpend(db, trySpendRef, 1);
  if (!result.ok) throw new OutOfEnergyForCraftingError();

  // Refill the pool to MAX, decrement immediately for this action.
  const refilledThenSpent = MAX_CRAFT_CREDITS - 1;
  await writeCraftCredits(db, ref, refilledThenSpent);
  return { remaining: refilledThenSpent, spentEnergy: true };
}

/**
 * Refund a craft credit on a failed action. Caps at MAX_CRAFT_CREDITS
 * — we never go above the pool size even if the caller refunds when
 * the pool is full.
 */
export async function refundCraftCredit(
  db: Db,
  ref: CreditPurseRef,
): Promise<number> {
  const current = await getCraftCredits(db, ref);
  if (current >= MAX_CRAFT_CREDITS) return current;
  const next = current + 1;
  await writeCraftCredits(db, ref, next);
  return next;
}
