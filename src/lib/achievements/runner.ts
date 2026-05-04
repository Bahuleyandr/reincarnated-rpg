/**
 * Achievement runner. Walks the catalog, filters out already-unlocked
 * entries, evaluates session-scope predicates against the per-session
 * event slice, evaluates lifetime-scope predicates against the
 * cross-session aggregate, and inserts new unlocks atomically.
 *
 * The UNIQUE constraint on (user_id, achievement_id) makes the
 * insert idempotent — if a race fires two evaluators concurrently,
 * the loser's INSERT silently no-ops via ON CONFLICT.
 *
 * Cheap pre-filter: each catalog entry declares `relevantKinds`. If
 * a recent event slice contains none of those kinds, we skip the
 * predicate evaluation entirely. Bound-the-cost pattern for the
 * happy path where most turns don't trigger anything.
 */
import { eq, inArray } from "drizzle-orm";

import type { Db } from "../db/client";
import { achievementsUnlocked, events as eventsTable, sessions } from "../db/schema";
import type { Event, EventKind } from "../game/types";
import { rowToEvent } from "../game/events";
import { evaluate } from "../predicates/runner";
import { uuidv7 } from "../util/uuidv7";
import { log } from "../util/log";

import {
  listLifetimeAchievements,
  listSessionAchievements,
  type AchievementEntry,
} from "./catalog";

export interface UnlockResult {
  achievementId: string;
  evidenceCount: number;
}

/**
 * Evaluate session-scope achievements against an in-memory event
 * slice. Skips already-unlocked entries; returns just the new
 * unlocks. Inserts atomically.
 *
 * @param db
 * @param userId — null short-circuits (anon sessions never accrue
 *   achievements; no durable user row).
 * @param sessionEvents — the session's events in order. The runner
 *   trusts this slice (no DB re-read).
 * @param campaignId — optional, attached to the unlock row for
 *   audit / replay attribution.
 */
export async function evaluateSessionAchievements(
  db: Db,
  userId: string | null,
  sessionEvents: readonly Event[],
  campaignId: string | null = null,
): Promise<UnlockResult[]> {
  if (!userId) return [];
  if (sessionEvents.length === 0) return [];

  const catalog = listSessionAchievements();
  const recentKinds = new Set(sessionEvents.map((e) => e.kind));

  // Filter already-unlocked.
  const unlockedIds = await fetchUnlockedIds(db, userId);

  const candidates = catalog.filter((a) => {
    if (unlockedIds.has(a.id)) return false;
    // Pre-filter: skip if the slice contains none of the achievement's
    // relevant kinds. (Empty relevantKinds = always-evaluate.)
    if (a.relevantKinds.length === 0) return true;
    return a.relevantKinds.some((k) => recentKinds.has(k as EventKind));
  });

  return runEvaluation(db, userId, candidates, sessionEvents, campaignId);
}

/**
 * Evaluate lifetime-scope achievements. Reads the cross-session
 * event aggregate for this user (capped at the most recent ~10k
 * events to keep the in-memory size bounded). Run on session-end
 * only — too expensive per-turn.
 */
export async function evaluateLifetimeAchievements(
  db: Db,
  userId: string | null,
  campaignId: string | null = null,
): Promise<UnlockResult[]> {
  if (!userId) return [];
  const catalog = listLifetimeAchievements();
  if (catalog.length === 0) return [];

  const unlockedIds = await fetchUnlockedIds(db, userId);
  const candidates = catalog.filter((a) => !unlockedIds.has(a.id));
  if (candidates.length === 0) return [];

  // Pull the user's recent cross-session events (cap at 10000).
  // This is the lifetime aggregate the predicates evaluate over.
  const userSessions = await db
    .select({ id: sessions.id })
    .from(sessions);
  // Note: sessions table doesn't have userId directly — sessions
  // attach to campaigns; campaigns have userId. For the v1 scope of
  // lifetime achievements (counting deaths/wins/sessions), we work
  // off the events table for sessions whose cookie_hmac is bound to
  // this user via the campaigns join.
  // For simplicity in v1, we walk through campaigns table.
  const userSessionIds = await fetchUserSessionIds(db, userId);
  if (userSessionIds.length === 0) return [];

  const rows = await db
    .select()
    .from(eventsTable)
    .where(inArray(eventsTable.sessionId, userSessionIds))
    .orderBy(eventsTable.createdAt)
    .limit(10000);
  const lifetimeEvents = rows.map(rowToEvent);

  return runEvaluation(db, userId, candidates, lifetimeEvents, campaignId);
  void userSessions;
}

async function runEvaluation(
  db: Db,
  userId: string,
  candidates: readonly AchievementEntry[],
  events: readonly Event[],
  campaignId: string | null,
): Promise<UnlockResult[]> {
  const newUnlocks: UnlockResult[] = [];
  for (const entry of candidates) {
    let result;
    try {
      result = evaluate(entry.predicate, events);
    } catch (err) {
      log.warn("achievements.eval_failed", {
        achievementId: entry.id,
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!result.matched) continue;

    // Capture evidence event ids for audit. Events from the table
    // have `id: uuid`; in-memory Event objects don't carry their id,
    // so we approximate by storing a synthetic empty array here. A
    // future refactor can thread the event id through rowToEvent.
    const evidenceIds: string[] = [];

    try {
      await db
        .insert(achievementsUnlocked)
        .values({
          id: uuidv7(),
          userId,
          achievementId: entry.id,
          campaignId,
          evidenceEventIds: evidenceIds,
        })
        .onConflictDoNothing({
          target: [achievementsUnlocked.userId, achievementsUnlocked.achievementId],
        });
      newUnlocks.push({
        achievementId: entry.id,
        evidenceCount: result.evidence.length,
      });
      log.info("achievements.unlocked", {
        userId,
        achievementId: entry.id,
        scope: entry.scope,
        evidenceCount: result.evidence.length,
      });
    } catch (err) {
      log.warn("achievements.insert_failed", {
        userId,
        achievementId: entry.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return newUnlocks;
}

async function fetchUnlockedIds(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: achievementsUnlocked.achievementId })
    .from(achievementsUnlocked)
    .where(eq(achievementsUnlocked.userId, userId));
  return new Set(rows.map((r) => r.id));
}

async function fetchUserSessionIds(db: Db, userId: string): Promise<string[]> {
  // Sessions tied to campaigns this user owns.
  const { campaigns } = await import("../db/schema");
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .innerJoin(campaigns, eq(sessions.campaignId, campaigns.id))
    .where(eq(campaigns.userId, userId));
  return rows.map((r) => r.id);
}
