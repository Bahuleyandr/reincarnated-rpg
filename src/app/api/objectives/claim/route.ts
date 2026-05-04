/**
 * POST /api/objectives/claim
 *
 * Body: { objectiveId: "..." }
 *
 * Claims the reward for a completed-but-unclaimed objective in the
 * current period. Idempotent — claiming an already-claimed
 * objective is a no-op. Validates: the user owns the row, the row
 * is for the current period, completed_at is set, reward_claimed_at
 * is null.
 *
 * Reward currently only kind="energy" — the player's energy is
 * bumped via adminSetEnergy (allowed to exceed the tier max as a
 * one-shot grant; same semantics as Blessing of the Gods +
 * streak).
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { objectiveProgress, users } from "@/lib/db/schema";
import { getObjective } from "@/lib/objectives/catalog";
import { periodKeyFor } from "@/lib/objectives/period";
import { SESSION_COOKIE_NAME, verifyCookie } from "@/lib/session/cookie";
import { log } from "@/lib/util/log";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = verified.userId;

  let body: { objectiveId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const objectiveId = (body.objectiveId ?? "").trim();
  if (!objectiveId) {
    return NextResponse.json({ error: "missing objectiveId" }, { status: 400 });
  }

  const obj = getObjective(objectiveId);
  if (!obj) {
    return NextResponse.json({ error: "unknown objective" }, { status: 404 });
  }

  const now = new Date();
  const periodKey = periodKeyFor(obj.period, now);

  // Find the row.
  const rows = await db
    .select()
    .from(objectiveProgress)
    .where(
      and(
        eq(objectiveProgress.userId, userId),
        eq(objectiveProgress.objectiveId, objectiveId),
        eq(objectiveProgress.periodKey, periodKey),
        isNotNull(objectiveProgress.completedAt),
        isNull(objectiveProgress.rewardClaimedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json(
      { error: "no claimable objective", objectiveId, periodKey },
      { status: 409 },
    );
  }

  // Apply reward + flip claimed atomically.
  if (obj.reward.kind === "energy") {
    // Atomic: increment users.energy by reward.amount, mark claimed.
    // Energy can exceed the tier max temporarily — same one-shot
    // grant semantics as streak / Blessing of the Gods.
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          energy: (await tx
            .select({ e: users.energy })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1))[0].e + obj.reward.amount,
          updatedAt: now,
        })
        .where(eq(users.id, userId));
      await tx
        .update(objectiveProgress)
        .set({ rewardClaimedAt: now, updatedAt: now })
        .where(eq(objectiveProgress.id, row.id));
    });
  }

  log.info("objectives.claimed", {
    userId,
    objectiveId,
    periodKey,
    reward: obj.reward,
  });

  return NextResponse.json({
    objectiveId,
    rewardClaimedAt: now.toISOString(),
    reward: obj.reward,
  });
}
