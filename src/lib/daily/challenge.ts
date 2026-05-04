/**
 * Daily shared-seed challenge — Phase 9 growth bet.
 *
 * Wordle-style: every player on a given UTC date plays the same
 * (form, location, seed). The challenge is a deterministic
 * function of the date — no admin intervention, no randomness
 * across players. Each user gets exactly one attempt per day.
 *
 * The pool is curated to ensure all four typed forms cycle
 * across the week + a generic-creature day; locations rotate
 * independently. The picker hashes the YYYY-MM-DD UTC date into
 * indices over both pools.
 *
 * Scoring (higher = better):
 *   won    : 10000 + (50 - turn_count)   (faster = better)
 *   capped : 5000  + turn_count          (longer survival = better)
 *   dead   : 1000  + turn_count          (longer survival = better)
 *   active : turn_count                   (in-progress)
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { dailyRuns, sessions, users } from "../db/schema";

export interface DailyChallenge {
  utcDate: string;
  formId: string;
  locationId: string;
  /** 32-bit unsigned, derived from the date hash. Used as the
   *  session.started seed so every player's RNG is identical. */
  seed: number;
}

/**
 * The challenge pools. Each entry is a (formId, locationId) pair
 * that's known to be playable end-to-end (arc-routing has the
 * matching beat pack OR the run plays free-form via the narrator).
 *
 * Forms are listed in display order so the rotation feels
 * narratively coherent: slime introduces the world, book
 * pivots to scriptorium, egg shifts to a stillness arc, core
 * shifts to dungeon-management, generic-creature opens the
 * frame for whatever players declare.
 */
export const CHALLENGE_POOL: Array<{ formId: string; locationId: string }> = [
  // Typed-form classics (the original 4 wedge-tested combinations).
  { formId: "lesser-slime", locationId: "collapsed-tunnel" },
  { formId: "cursed-book", locationId: "sunless-spire" },
  { formId: "dragon-egg", locationId: "forsaken-village" },
  { formId: "dungeon-core", locationId: "sunless-spire" },
  // Cross-typed combos.
  { formId: "lesser-slime", locationId: "drowned-orchard" },
  { formId: "cursed-book", locationId: "salt-cathedral" },
  { formId: "dungeon-core", locationId: "hollow-market" },
  // Phase-9 world: typed forms in the racial homelands.
  { formId: "lesser-slime", locationId: "caelum-by-the-wash" },
  { formId: "lesser-slime", locationId: "saltgale" },
  { formId: "cursed-book", locationId: "the-long-indices" },
  { formId: "cursed-book", locationId: "threadwarden" },
  { formId: "dragon-egg", locationId: "highfield-ascending" },
  { formId: "dragon-egg", locationId: "the-coral-anchorage" },
  { formId: "dungeon-core", locationId: "tallowfen" },
  { formId: "dungeon-core", locationId: "the-long-indices" },
  // Generic-creature in the new world — open-ended declarations.
  { formId: "generic-creature", locationId: "caelum-by-the-wash" },
  { formId: "generic-creature", locationId: "threadwarden" },
  { formId: "generic-creature", locationId: "saltgale" },
  { formId: "generic-creature", locationId: "highfield-ascending" },
  { formId: "generic-creature", locationId: "the-coral-anchorage" },
  { formId: "generic-creature", locationId: "the-long-indices" },
  // Small-town daily features (one rotation through the towns).
  { formId: "generic-creature", locationId: "mudmoth" },
  { formId: "generic-creature", locationId: "quietmile" },
  { formId: "generic-creature", locationId: "crab-by-crab" },
  { formId: "generic-creature", locationId: "coldspoon" },
];

/**
 * Hash a YYYY-MM-DD string into a 32-bit unsigned integer.
 * Mulberry-style mixer using the date bytes; deterministic and
 * stable across runtimes.
 */
function hashDate(utcDate: string): number {
  let h = 2166136261 >>> 0; // FNV-1a offset basis
  for (let i = 0; i < utcDate.length; i++) {
    h ^= utcDate.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function pickDailyChallenge(utcDate: string): DailyChallenge {
  const h = hashDate(utcDate);
  const pick = CHALLENGE_POOL[h % CHALLENGE_POOL.length];
  // Derive a per-day session seed from the same hash but rotated
  // so it doesn't equal the index hash.
  const seed = (h ^ 0x9e3779b1) >>> 0;
  return {
    utcDate,
    formId: pick.formId,
    locationId: pick.locationId,
    seed,
  };
}

export interface DailyStatus {
  challenge: DailyChallenge;
  /** Null when the player has not yet started today's run. */
  run: {
    sessionId: string;
    status: string;
    turnCount: number;
    score: number;
    endedAtMs: number | null;
    startedAtMs: number;
  } | null;
}

export async function getDailyStatus(
  db: Db,
  args: { userId: string; utcDate: string },
): Promise<DailyStatus> {
  const [row] = await db
    .select()
    .from(dailyRuns)
    .where(
      and(
        eq(dailyRuns.utcDate, args.utcDate),
        eq(dailyRuns.userId, args.userId),
      ),
    )
    .limit(1);
  return {
    challenge: pickDailyChallenge(args.utcDate),
    run: row
      ? {
          sessionId: row.sessionId,
          status: row.status,
          turnCount: row.turnCount,
          score: row.score,
          endedAtMs: row.endedAt?.getTime() ?? null,
          startedAtMs: row.startedAt.getTime(),
        }
      : null,
  };
}

export type StartDailyResult =
  | { ok: true; sessionId: string; challenge: DailyChallenge }
  | { ok: false; error: "already_played" | "session_create_failed" };

/**
 * Atomically reserve today's daily slot for the user. Returns the
 * existing run on second attempts. The caller is responsible for
 * inserting the session.started event with the challenge's seed.
 */
export async function reserveDailyRun(
  db: Db,
  args: { userId: string; utcDate: string; sessionId: string },
): Promise<StartDailyResult> {
  const challenge = pickDailyChallenge(args.utcDate);
  try {
    await db.insert(dailyRuns).values({
      utcDate: args.utcDate,
      userId: args.userId,
      sessionId: args.sessionId,
      formId: challenge.formId,
      locationId: challenge.locationId,
      seed: challenge.seed,
    });
    return { ok: true, sessionId: args.sessionId, challenge };
  } catch (err) {
    // Unique-index violation = user already has a row for today.
    // Postgres standard error code 23505 (unique_violation).
    // Drizzle wraps the underlying postgres-js error; the
    // PostgresError lives on `cause`. We check both layers so
    // the detection works regardless of how callers wrap the
    // throw.
    const e = err as { code?: string; message?: string; cause?: unknown };
    const cause = e.cause as
      | { code?: string; message?: string }
      | undefined;
    const code = e.code ?? cause?.code;
    const fullMsg = `${e.message ?? ""} ${cause?.message ?? ""} ${String(err)}`;
    if (
      code === "23505" ||
      /duplicate|unique|daily_runs_pk/i.test(fullMsg)
    ) {
      return { ok: false, error: "already_played" };
    }
    return { ok: false, error: "session_create_failed" };
  }
}

/**
 * Compute the score from a run's outcome. Used by the turn
 * orchestrator's session.ended hook to update daily_runs.score.
 */
export function computeDailyScore(args: {
  status: "active" | "won" | "dead" | "capped";
  turnCount: number;
}): number {
  switch (args.status) {
    case "won":
      return 10000 + Math.max(0, 50 - args.turnCount);
    case "capped":
      return 5000 + args.turnCount;
    case "dead":
      return 1000 + args.turnCount;
    case "active":
      return args.turnCount;
  }
}

/**
 * Update the daily_runs row's status + score after a turn.
 * Idempotent — calling on each turn keeps the leaderboard
 * live without extra logic.
 */
export async function updateDailyProgress(
  db: Db,
  args: {
    userId: string;
    utcDate: string;
    status: "active" | "won" | "dead" | "capped";
    turnCount: number;
  },
): Promise<void> {
  const score = computeDailyScore(args);
  const ended = args.status !== "active";
  await db
    .update(dailyRuns)
    .set({
      status: args.status,
      turnCount: args.turnCount,
      score,
      endedAt: ended ? new Date() : null,
    })
    .where(
      and(
        eq(dailyRuns.utcDate, args.utcDate),
        eq(dailyRuns.userId, args.userId),
      ),
    );
}

export interface LeaderboardRow {
  userId: string;
  username: string;
  formId: string;
  locationId: string;
  status: string;
  turnCount: number;
  score: number;
  endedAtMs: number | null;
}

export async function dailyLeaderboard(
  db: Db,
  args: { utcDate: string; limit?: number },
): Promise<LeaderboardRow[]> {
  const limit = Math.max(1, Math.min(100, args.limit ?? 25));
  const rows = await db
    .select({
      userId: dailyRuns.userId,
      username: users.username,
      formId: dailyRuns.formId,
      locationId: dailyRuns.locationId,
      status: dailyRuns.status,
      turnCount: dailyRuns.turnCount,
      score: dailyRuns.score,
      endedAt: dailyRuns.endedAt,
    })
    .from(dailyRuns)
    .innerJoin(users, eq(users.id, dailyRuns.userId))
    .where(eq(dailyRuns.utcDate, args.utcDate))
    .orderBy(desc(dailyRuns.score))
    .limit(limit);
  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    formId: r.formId,
    locationId: r.locationId,
    status: r.status,
    turnCount: r.turnCount,
    score: r.score,
    endedAtMs: r.endedAt?.getTime() ?? null,
  }));
}

/**
 * Finds the daily_runs row tied to a session (if any). Used by
 * the turn orchestrator to update progress only when the
 * current session is a daily run. Returns null for non-daily
 * sessions.
 */
export async function findDailyForSession(
  db: Db,
  sessionId: string,
): Promise<{ userId: string; utcDate: string } | null> {
  const [row] = await db
    .select({
      userId: dailyRuns.userId,
      utcDate: dailyRuns.utcDate,
    })
    .from(dailyRuns)
    .where(eq(dailyRuns.sessionId, sessionId))
    .limit(1);
  return row ?? null;
}

/**
 * Player history — recent dailies completed. Used for the
 * "your recent dailies" surface on /daily.
 */
export async function userDailyHistory(
  db: Db,
  args: { userId: string; days?: number },
): Promise<
  Array<{
    utcDate: string;
    formId: string;
    status: string;
    turnCount: number;
    score: number;
  }>
> {
  const days = Math.max(1, Math.min(60, args.days ?? 14));
  const rows = await db
    .select()
    .from(dailyRuns)
    .where(eq(dailyRuns.userId, args.userId))
    .orderBy(desc(dailyRuns.utcDate))
    .limit(days);
  return rows.map((r) => ({
    utcDate: r.utcDate,
    formId: r.formId,
    status: r.status,
    turnCount: r.turnCount,
    score: r.score,
  }));
}

// Suppress unused import warnings for the helpers used in the
// schema query above (kept for type-narrowing).
void gte;
void sessions;
void sql;
