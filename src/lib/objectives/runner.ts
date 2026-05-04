/**
 * Objective progress runner. Walks the catalog, for each objective:
 *   1. Skip if the recent event slice doesn't include any of the
 *      objective's relevantKinds (cheap pre-filter).
 *   2. Run the predicate over a single event at a time. For each
 *      event that matches, increment the per-(user, objective,
 *      period) progress counter by 1.
 *   3. Flip completed_at when progress reaches target. Reward is
 *      claimed via a separate explicit POST endpoint; we never
 *      auto-grant.
 *
 * Per-event evaluation (vs whole-slice as in achievements) is
 * intentional: objectives count discrete occurrences, not "did
 * something happen at all this turn".
 *
 * Idempotence: ON CONFLICT DO UPDATE on the unique
 * (user_id, objective_id, period_key) constraint. Concurrent turns
 * for the same player race-update the row; one increment may be
 * lost in the worst case — acceptable for these stakes.
 */
import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { objectiveProgress } from "../db/schema";
import type { Event } from "../game/types";
import { evaluate } from "../predicates/runner";
import { uuidv7 } from "../util/uuidv7";
import { log } from "../util/log";

import { listObjectives } from "./catalog";
import { periodKeyFor } from "./period";

export interface ProgressTick {
  objectiveId: string;
  newProgress: number;
  target: number;
  completed: boolean;
}

/**
 * Increment any matching objectives based on the events emitted on
 * the current turn. Returns a list of ticks for any progress that
 * advanced. Caller (turn route) can surface these as little flashes.
 */
export async function tickObjectives(
  db: Db,
  userId: string | null,
  newEvents: readonly Event[],
  now: Date = new Date(),
): Promise<ProgressTick[]> {
  if (!userId) return [];
  if (newEvents.length === 0) return [];

  const ticks: ProgressTick[] = [];
  const recentKinds = new Set(newEvents.map((e) => e.kind));

  for (const obj of listObjectives()) {
    // Pre-filter.
    if (
      obj.relevantKinds.length > 0 &&
      !obj.relevantKinds.some((k) => recentKinds.has(k))
    ) {
      continue;
    }

    // Count matching events.
    let matchCount = 0;
    for (const e of newEvents) {
      try {
        if (evaluate(obj.predicate, [e]).matched) matchCount += 1;
      } catch (err) {
        log.warn("objectives.eval_failed", {
          objectiveId: obj.id,
          err: err instanceof Error ? err.message : String(err),
        });
        break;
      }
    }
    if (matchCount === 0) continue;

    const periodKey = periodKeyFor(obj.period, now);

    try {
      // UPSERT — increment progress, flip completed_at when target
      // reached. Idempotent under concurrent races: ON CONFLICT
      // does an additive UPDATE of progress.
      const result = (await db.$client`
        INSERT INTO objective_progress (
          id, user_id, objective_id, period_key, progress, target,
          completed_at, created_at, updated_at
        )
        VALUES (
          ${uuidv7()},
          ${userId},
          ${obj.id},
          ${periodKey},
          ${matchCount},
          ${obj.target},
          ${matchCount >= obj.target ? new Date(now).toISOString() : null}::timestamptz,
          now(),
          now()
        )
        ON CONFLICT (user_id, objective_id, period_key) DO UPDATE
          SET progress = LEAST(
                objective_progress.progress + ${matchCount},
                objective_progress.target
              ),
              completed_at = COALESCE(
                objective_progress.completed_at,
                CASE
                  WHEN objective_progress.progress + ${matchCount} >= objective_progress.target
                  THEN now()
                  ELSE NULL
                END
              ),
              updated_at = now()
        RETURNING progress, target, completed_at
      `) as Array<{ progress: number; target: number; completed_at: Date | null }>;
      const row = result[0];
      if (!row) continue;
      ticks.push({
        objectiveId: obj.id,
        newProgress: row.progress,
        target: row.target,
        completed: row.completed_at !== null,
      });
    } catch (err) {
      log.warn("objectives.upsert_failed", {
        objectiveId: obj.id,
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return ticks;
}

/**
 * Returns the user's progress rows for the current daily + weekly
 * periods. Used by /api/objectives GET.
 */
export async function getActiveProgress(
  db: Db,
  userId: string,
  now: Date = new Date(),
) {
  const dailyPK = periodKeyFor("daily", now);
  const weeklyPK = periodKeyFor("weekly", now);
  const rows = await db
    .select()
    .from(objectiveProgress)
    .where(
      and(
        eq(objectiveProgress.userId, userId),
        sql`${objectiveProgress.periodKey} IN (${dailyPK}, ${weeklyPK})`,
      ),
    );
  return rows;
}
