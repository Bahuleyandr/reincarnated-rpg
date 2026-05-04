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
 */
export async function composeStarterFormState(
  db: Db,
  args: ComposeArgs,
): Promise<Record<string, number> | undefined> {
  const base: Record<string, number> = args.starterBonus
    ? { [args.starterBonus.field]: args.starterBonus.value }
    : {};

  let legacyDelta: Record<string, number> = {};
  if (args.userId) {
    try {
      const rows = await db
        .select({ legacyTraits: users.legacyTraits })
        .from(users)
        .where(eq(users.id, args.userId))
        .limit(1);
      const counts = (rows[0]?.legacyTraits ?? {}) as Record<string, number>;
      legacyDelta = applyLegacyTraitsToStarterFormState(counts);
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
  return Object.keys(merged).length > 0 ? merged : undefined;
}
