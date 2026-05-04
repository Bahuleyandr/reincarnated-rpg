/**
 * Tutorial graduation — Phase 5.5 Day 36-37.
 *
 * On session.ended (any reason) for a tutorial session, flip the
 * user's `tutorialCompleted` flag and clear `is_tutorial` on the
 * session. Subsequent /reincarnate calls return the normal picker.
 *
 * Tutorial sessions are excluded from leaderboards + meta-arc
 * contributions; the orchestrator checks `is_tutorial` before
 * those side effects fire.
 */
import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";
import { log } from "../util/log";

export async function graduateTutorial(
  db: Db,
  sessionId: string,
  userId: string,
): Promise<{ graduated: boolean }> {
  const [row] = await db
    .select({ isTutorial: sessions.isTutorial })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  if (!row?.isTutorial) return { graduated: false };
  await db
    .update(users)
    .set({ tutorialCompleted: true, updatedAt: new Date() })
    .where(eq(users.id, userId));
  log.info("tutorial.graduated", { sessionId, userId });
  return { graduated: true };
}

/**
 * Skip-tutorial path: same effect as graduate but the session
 * stays open. Called from `POST /api/tutorial/skip` when the
 * player clicks the skip link on turn 1.
 */
export async function skipTutorial(
  db: Db,
  sessionId: string,
  userId: string,
): Promise<{ skipped: boolean }> {
  await db
    .update(users)
    .set({ tutorialCompleted: true, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await db
    .update(sessions)
    .set({ isTutorial: false })
    .where(eq(sessions.id, sessionId));
  log.info("tutorial.skipped", { sessionId, userId });
  return { skipped: true };
}
