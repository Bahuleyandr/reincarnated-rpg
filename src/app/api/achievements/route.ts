/**
 * GET /api/achievements
 *
 * Returns the requesting user's unlocked achievements + the public
 * catalog metadata for any non-hidden achievements they haven't yet
 * unlocked. Predicates are NOT exposed (the server side knows them;
 * clients don't need to).
 *
 * Hidden achievements only appear in the response when the user has
 * actually unlocked them — surfacing them earlier would spoil the
 * surprise.
 */
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { achievementsUnlocked } from "@/lib/db/schema";
import { listAchievements } from "@/lib/achievements/catalog";
import { SESSION_COOKIE_NAME, verifyCookie } from "@/lib/session/cookie";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = verified.userId;

  const unlocks = await db
    .select({
      achievementId: achievementsUnlocked.achievementId,
      unlockedAt: achievementsUnlocked.unlockedAt,
      campaignId: achievementsUnlocked.campaignId,
    })
    .from(achievementsUnlocked)
    .where(eq(achievementsUnlocked.userId, userId))
    .orderBy(desc(achievementsUnlocked.unlockedAt));

  const unlockedIds = new Set(unlocks.map((u) => u.achievementId));
  const catalog = listAchievements();

  // Public projection of the catalog: omit predicates; reveal hidden
  // entries only when the user has unlocked them.
  const visible = catalog
    .filter((a) => !a.hidden || unlockedIds.has(a.id))
    .map((a) => ({
      id: a.id,
      label: a.label,
      description: a.description,
      scope: a.scope,
      titleAwarded: a.titleAwarded ?? null,
      hidden: a.hidden ?? false,
      unlocked: unlockedIds.has(a.id),
    }));

  return NextResponse.json({
    unlocks: unlocks.map((u) => ({
      achievementId: u.achievementId,
      unlockedAtMs: u.unlockedAt.getTime(),
      campaignId: u.campaignId,
    })),
    catalog: visible,
    totals: {
      unlocked: unlockedIds.size,
      total: catalog.filter((a) => !a.hidden).length,
    },
  });
}
