/**
 * Duel resolution — Phase 9 T5.5 follow-up.
 *
 * Pure-function dice math + a side-effecting wrapper that
 * persists the rolls + winner + status transition.
 *
 * Rules:
 *   - 2d6 + faction modifier per side. Faction modifier is +1
 *     when the side's race/faction matches the duel's
 *     contextFaction; 0 otherwise.
 *   - Higher total wins. Ties = no winner; status flips to
 *     "resolved" with winnerUserId=null (a tie counts).
 *   - Resolution is one-shot: once resolved, status is
 *     terminal. The route gates on accepted-status.
 */
import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { duels, users } from "../db/schema";
import { mulberry32, rollDie } from "../util/rng";

export interface DuelRollResult {
  d1: number;
  d2: number;
  total: number;
  factionBonus: number;
  finalTotal: number;
}

/**
 * Pure: roll 2d6 with a stable seed + return the total + faction
 * bonus. Used by the deterministic resolution path.
 */
export function rollDuelSide(args: {
  seed: number;
  factionMatches: boolean;
}): DuelRollResult {
  const rng = mulberry32(args.seed >>> 0);
  const d1 = rollDie(rng);
  const d2 = rollDie(rng);
  const total = d1 + d2;
  const bonus = args.factionMatches ? 1 : 0;
  return {
    d1,
    d2,
    total,
    factionBonus: bonus,
    finalTotal: total + bonus,
  };
}

export type ResolveResult =
  | {
      ok: true;
      challengerRoll: number;
      targetRoll: number;
      winnerUserId: string | null;
      tied: boolean;
    }
  | {
      ok: false;
      error:
        | "duel_not_found"
        | "wrong_status"
        | "target_is_npc_resolution_unsupported";
    };

const SEED_MAGIC = 0xa1b2c3d4;

/**
 * Resolve an accepted duel. Side-effecting:
 *   - rolls 2d6 per side (deterministic from duel.id hash)
 *   - persists challenger_roll, target_roll, winner_user_id
 *   - flips status to "resolved", sets resolved_at
 *
 * NPC duels are not resolved here — those need a recurring-NPC
 * stat lookup that's out of scope. Returns
 * target_is_npc_resolution_unsupported.
 */
export async function resolveDuel(
  db: Db,
  duelId: string,
): Promise<ResolveResult> {
  const [d] = await db
    .select()
    .from(duels)
    .where(eq(duels.id, duelId))
    .limit(1);
  if (!d) return { ok: false, error: "duel_not_found" };
  if (d.status !== "accepted") {
    return { ok: false, error: "wrong_status" };
  }
  if (!d.targetUserId) {
    return {
      ok: false,
      error: "target_is_npc_resolution_unsupported",
    };
  }

  // Look up each side's race for the faction-match check.
  const [challenger] = await db
    .select({ id: users.id, race: users.race })
    .from(users)
    .where(eq(users.id, d.challengerUserId))
    .limit(1);
  const [target] = await db
    .select({ id: users.id, race: users.race })
    .from(users)
    .where(eq(users.id, d.targetUserId))
    .limit(1);
  // Deterministic per-duel seeds: hash of duel id + a magic
  // separator per side.
  const baseSeed = simpleHash(d.id);
  const cRoll = rollDuelSide({
    seed: (baseSeed ^ 0xc0ffee) >>> 0,
    factionMatches:
      d.contextFaction !== null && challenger?.race === d.contextFaction,
  });
  const tRoll = rollDuelSide({
    seed: (baseSeed ^ SEED_MAGIC) >>> 0,
    factionMatches:
      d.contextFaction !== null && target?.race === d.contextFaction,
  });
  const tied = cRoll.finalTotal === tRoll.finalTotal;
  const winnerUserId = tied
    ? null
    : cRoll.finalTotal > tRoll.finalTotal
      ? d.challengerUserId
      : d.targetUserId;
  await db
    .update(duels)
    .set({
      challengerRoll: cRoll.finalTotal,
      targetRoll: tRoll.finalTotal,
      winnerUserId,
      status: "resolved",
      resolvedAt: new Date(),
    })
    .where(eq(duels.id, duelId));
  return {
    ok: true,
    challengerRoll: cRoll.finalTotal,
    targetRoll: tRoll.finalTotal,
    winnerUserId,
    tied,
  };
}

function simpleHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
