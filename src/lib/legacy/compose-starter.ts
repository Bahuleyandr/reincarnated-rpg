/**
 * Compose starterFormState for runTurn from two sources:
 *   1. The campaign's starterBonus (one-shot per reincarnation
 *      pick — see lib/game/reincarnation-picker.ts).
 *   2. The player's legacy traits (cross-run, persistent — see
 *      lib/legacy/imprint.ts + apply.ts).
 *
 * Both merge additively. Overlapping fields sum (campaign bonus +
 * legacy buff). Field-level clamping happens inside applyLegacyTraits.
 *
 * Anon sessions: legacyDelta is empty (no userId, no durable traits).
 */
import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { users } from "../db/schema";
import { applyRaceStarter } from "../race/mechanics";
import { log } from "../util/log";

import { applyLegacyTraitsToStarterFormState } from "./apply";

export interface ComposeArgs {
  /** The campaign's starterBonus payload (or null when none). */
  starterBonus: { field: string; value: number } | null;
  /** Logged-in user id; null for anon sessions. */
  userId: string | null;
}

/**
 * Returns the merged starterFormState, or undefined when both
 * sources are empty (so callers can pass `undefined` directly).
 *
 * Three sources merged additively:
 *   1. Campaign starterBonus (one per reincarnation pick).
 *   2. Player legacy traits (cross-run, persistent).
 *   3. Player race modifier (Phase 9 T3.2; one bump per race).
 *
 * Field-level clamping happens inside applyLegacyTraits.
 */
export async function composeStarterFormState(
  db: Db,
  args: ComposeArgs,
): Promise<Record<string, number> | undefined> {
  const base: Record<string, number> = args.starterBonus
    ? { [args.starterBonus.field]: args.starterBonus.value }
    : {};

  let legacyDelta: Record<string, number> = {};
  let raceId: string | null = null;
  if (args.userId) {
    try {
      const rows = await db
        .select({ legacyTraits: users.legacyTraits, race: users.race })
        .from(users)
        .where(eq(users.id, args.userId))
        .limit(1);
      const counts = (rows[0]?.legacyTraits ?? {}) as Record<string, number>;
      legacyDelta = applyLegacyTraitsToStarterFormState(counts);
      raceId = rows[0]?.race ?? null;
    } catch (err) {
      log.warn("legacy.apply_failed", {
        userId: args.userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const merged: Record<string, number> = { ...base, ...legacyDelta };
  for (const k of Object.keys(legacyDelta)) {
    if (k in base) merged[k] = base[k] + legacyDelta[k];
  }
  // Phase 9 T3.2 — race buffs land last so they show up across all
  // form/region combos, not just specific catalog picks.
  const withRace = applyRaceStarter(merged, raceId);
  return Object.keys(withRace).length > 0 ? withRace : undefined;
}
