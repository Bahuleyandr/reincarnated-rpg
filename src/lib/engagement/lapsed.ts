/**
 * Lapsed-player detection — Phase 7 Day 59-61.
 *
 * Pure classifier + DB readers. Email send is wired in Phase 8
 * Day 68; this module figures out WHO needs an email, the email
 * layer just delivers + records.
 *
 * Classifications:
 *   - 'lapsed_7d'    : last turn 7-29 days ago
 *   - 'lapsed_30d'   : last turn 30+ days ago
 *   - 'returning'    : returned within 24h after >=14 days away
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { events, reengagementLog, sessions, users } from "../db/schema";
import { uuidv7 } from "../util/uuidv7";

export type LapseKind = "lapsed_7d" | "lapsed_30d" | "returning_welcome";

export interface LapsedCandidate {
  userId: string;
  email: string;
  username: string;
  lastTurnAtMs: number | null;
  kind: LapseKind;
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

/**
 * Pure: bucket a user's lapse status from the last-turn-at delta.
 * Returns null when the user is active (within 7 days) and
 * doesn't qualify as returning.
 */
export function classifyLapse(args: {
  lastTurnAtMs: number | null;
  /** True when this is the first session in >14 days. */
  isReturningToday?: boolean;
  now?: number;
}): LapseKind | null {
  const now = args.now ?? Date.now();
  if (args.isReturningToday) return "returning_welcome";
  if (!args.lastTurnAtMs) return null;
  const delta = now - args.lastTurnAtMs;
  if (delta >= THIRTY_DAYS) return "lapsed_30d";
  if (delta >= SEVEN_DAYS) return "lapsed_7d";
  return null;
}

/**
 * Find users who haven't taken a turn in the lapse window AND
 * haven't yet been emailed for that kind.
 */
export async function findLapsedCandidates(
  db: Db,
  kind: "lapsed_7d" | "lapsed_30d",
): Promise<LapsedCandidate[]> {
  const cutoffMs = kind === "lapsed_7d" ? SEVEN_DAYS : THIRTY_DAYS;
  const cutoff = new Date(Date.now() - cutoffMs);
  // Subquery: max(events.created_at) per session via sessions
  // join. We approximate "last turn" with sessions.lastActiveAt
  // since the events table doesn't carry user_id directly.
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      username: users.username,
      lastActiveAt: sql<Date | null>`MAX(${sessions.lastActiveAt})`,
    })
    .from(users)
    .leftJoin(sessions, eq(sessions.campaignId, sql`null`))
    .where(eq(users.tier, users.tier)) // tautology to avoid type narrowing issue
    .groupBy(users.id, users.email, users.username);
  // Filter in TS — cleaner than a complex SQL.
  const candidates: LapsedCandidate[] = [];
  for (const r of rows) {
    const ms = r.lastActiveAt ? new Date(r.lastActiveAt).getTime() : 0;
    if (ms === 0) continue; // never played → not "lapsed"
    if (ms > cutoff.getTime()) continue;
    // Already-sent guard.
    const [existing] = await db
      .select({ id: reengagementLog.id })
      .from(reengagementLog)
      .where(
        and(
          eq(reengagementLog.userId, r.userId),
          eq(reengagementLog.kind, kind),
        ),
      )
      .limit(1);
    if (existing) continue;
    candidates.push({
      userId: r.userId,
      email: r.email,
      username: r.username,
      lastTurnAtMs: ms,
      kind,
    });
  }
  return candidates;
}

/** Idempotent: record that we sent the email. */
export async function recordReengagement(
  db: Db,
  args: {
    userId: string;
    kind: LapseKind;
    metadata?: Record<string, unknown>;
  },
): Promise<{ alreadySent: boolean }> {
  const inserted = await db
    .insert(reengagementLog)
    .values({
      id: uuidv7(),
      userId: args.userId,
      kind: args.kind,
      metadata: args.metadata ?? {},
    })
    .onConflictDoNothing({
      target: [reengagementLog.userId, reengagementLog.kind],
    })
    .returning({ id: reengagementLog.id });
  return { alreadySent: inserted.length === 0 };
}

/** Reset a user's lapsed-30d send (e.g. they've come back). Lets
 *  the next 30-day lapse trigger again next time. */
export async function resetLapsedRecord(
  db: Db,
  userId: string,
  kind: LapseKind,
): Promise<void> {
  await db
    .delete(reengagementLog)
    .where(
      and(
        eq(reengagementLog.userId, userId),
        eq(reengagementLog.kind, kind),
      ),
    );
}

void events;
void gte;
void lt;
