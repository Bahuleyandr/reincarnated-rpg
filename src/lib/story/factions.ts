/**
 * Faction state — Phase 7 Day 42-43.
 *
 * Pledge is one-shot per user (50 coins). Contributions append to
 * faction_contributions and bump the faction's
 * cumulative_contribution counter atomically; branch resolution
 * (Day 44) reads the same counters.
 *
 * Faction-aligned skill XP gets a small bonus — alchemy/farming
 * for choristers, smithing/smelting for rust_hand, etc. The
 * mapping lives in `factionSkillBonus`.
 */
import { and, desc, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import {
  factionContributions,
  factions,
  users,
} from "../db/schema";
import { getCoins } from "../economy/coins";
import { uuidv7 } from "../util/uuidv7";

export const PLEDGE_COST_COINS = 50;

export interface FactionPublic {
  id: string;
  label: string;
  description: string | null;
  memberCount: number;
  cumulativeContribution: number;
  active: boolean;
}

export async function listFactions(db: Db): Promise<FactionPublic[]> {
  const rows = await db.select().from(factions).orderBy(desc(factions.active));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    memberCount: r.memberCount,
    cumulativeContribution: r.cumulativeContribution,
    active: r.active,
  }));
}

export async function getUserFaction(
  db: Db,
  userId: string,
): Promise<{ factionId: string; pledgedAtMs: number } | null> {
  const [row] = await db
    .select({
      factionId: users.factionId,
      pledgedAt: users.factionPledgedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.factionId || !row.pledgedAt) return null;
  return { factionId: row.factionId, pledgedAtMs: row.pledgedAt.getTime() };
}

export interface PledgeResult {
  ok: true;
  factionId: string;
  pledgedAtMs: number;
}

export type PledgeError =
  | { ok: false; error: "already_pledged" }
  | { ok: false; error: "unknown_faction" }
  | { ok: false; error: "faction_inactive" }
  | { ok: false; error: "insufficient_coins"; need: number; have: number };

export async function pledgeFaction(
  db: Db,
  args: { userId: string; factionId: string },
): Promise<PledgeResult | PledgeError> {
  const [existing] = await db
    .select({
      pledgedAt: users.factionPledgedAt,
      currentFaction: users.factionId,
    })
    .from(users)
    .where(eq(users.id, args.userId))
    .limit(1);
  if (existing?.pledgedAt && existing.currentFaction) {
    return { ok: false, error: "already_pledged" };
  }
  const [faction] = await db
    .select()
    .from(factions)
    .where(eq(factions.id, args.factionId))
    .limit(1);
  if (!faction) return { ok: false, error: "unknown_faction" };
  if (!faction.active) return { ok: false, error: "faction_inactive" };

  // Coin gate (defense in depth — the tool validator already
  // checked currentCoins before the event was emitted).
  const have = await getCoins(db, { userId: args.userId });
  if (have < PLEDGE_COST_COINS) {
    return {
      ok: false,
      error: "insufficient_coins",
      need: PLEDGE_COST_COINS,
      have,
    };
  }
  // NOTE: pledgeFaction does NOT debit coins. The pledge_faction
  // tool emits coins.spent in the same batch, and the
  // orchestrator's netCoinDeltaFromEvents rollup applies that
  // debit to users.coins. Charging here would double-debit. The
  // direct API path (POST /api/factions/pledge) calls
  // applyCoinDelta itself for the same reason.

  const now = new Date();
  await db
    .update(users)
    .set({
      factionId: args.factionId,
      factionPledgedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, args.userId));
  await db
    .update(factions)
    .set({
      memberCount: sql`${factions.memberCount} + 1`,
      updatedAt: now,
    })
    .where(eq(factions.id, args.factionId));
  return { ok: true, factionId: args.factionId, pledgedAtMs: now.getTime() };
}

/**
 * Add a contribution row + bump the faction's cumulative counter.
 * Used by skill-aligned crafts, ritual events, edicts, etc.
 */
export async function recordFactionContribution(
  db: Db,
  args: {
    userId: string | null;
    factionId: string;
    chapterId: number;
    amount: number;
    source: string;
  },
): Promise<void> {
  if (args.amount <= 0) return;
  await db.insert(factionContributions).values({
    id: uuidv7(),
    userId: args.userId,
    factionId: args.factionId,
    chapterId: args.chapterId,
    amount: args.amount,
    source: args.source,
  });
  await db
    .update(factions)
    .set({
      cumulativeContribution: sql`${factions.cumulativeContribution} + ${args.amount}`,
      updatedAt: new Date(),
    })
    .where(eq(factions.id, args.factionId));
}

/**
 * Pure: per-faction skill bonus multiplier. Each faction favors a
 * cluster of skills; XP awards in those skills are multiplied by
 * 1.10 when the player is pledged to that faction.
 */
const FACTION_SKILLS: Record<string, ReadonlySet<string>> = {
  choristers: new Set(["alchemy", "cooking", "farming"]),
  rust_hand: new Set(["smithing", "smelting", "mining"]),
  idle: new Set([]), // idle gets no bonus — refusal is the discipline
  forsaken: new Set(["woodcutting", "alchemy"]),
};

export const FACTION_SKILL_BONUS = 1.1;

export function factionSkillBonus(args: {
  factionId: string | null;
  skillId: string;
}): number {
  if (!args.factionId) return 1;
  const skills = FACTION_SKILLS[args.factionId];
  if (!skills) return 1;
  return skills.has(args.skillId) ? FACTION_SKILL_BONUS : 1;
}

export async function aggregatePerFaction(
  db: Db,
  chapterId: number,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      factionId: factionContributions.factionId,
      total: sql<number>`COALESCE(SUM(${factionContributions.amount}), 0)::int`,
    })
    .from(factionContributions)
    .where(eq(factionContributions.chapterId, chapterId))
    .groupBy(factionContributions.factionId);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.factionId] = r.total;
  return out;
}

void and;
