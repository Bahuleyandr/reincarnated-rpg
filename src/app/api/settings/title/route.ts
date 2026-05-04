/**
 * POST /api/settings/title
 *
 * Set or clear the player's pinned title. Validates the title slug
 * against the player's actual unlocks — sending a slug they haven't
 * earned returns 403, not silently accepted. POST {title: null}
 * clears the pin.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { achievementsUnlocked, users } from "@/lib/db/schema";
import { listAchievements } from "@/lib/achievements/catalog";
import { SESSION_COOKIE_NAME, verifyCookie } from "@/lib/session/cookie";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = verified.userId;

  let body: { title?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const titleRaw = body.title;
  if (titleRaw === null || titleRaw === undefined || titleRaw === "") {
    // Clear the pin.
    await db.update(users).set({ pinnedTitle: null }).where(eq(users.id, userId));
    return NextResponse.json({ pinnedTitle: null });
  }
  if (typeof titleRaw !== "string") {
    return NextResponse.json({ error: "title must be a string or null" }, { status: 400 });
  }
  const title = titleRaw.trim();
  if (title.length === 0) {
    await db.update(users).set({ pinnedTitle: null }).where(eq(users.id, userId));
    return NextResponse.json({ pinnedTitle: null });
  }

  // Validate: the title must be one the user has actually earned.
  // Catalog → set of titles awarded by the user's unlocked
  // achievements.
  const unlocks = await db
    .select({ achievementId: achievementsUnlocked.achievementId })
    .from(achievementsUnlocked)
    .where(eq(achievementsUnlocked.userId, userId));
  const unlockedIds = new Set(unlocks.map((u) => u.achievementId));
  const earnedTitles = new Set<string>();
  for (const a of listAchievements()) {
    if (a.titleAwarded && unlockedIds.has(a.id)) earnedTitles.add(a.titleAwarded);
  }
  if (!earnedTitles.has(title)) {
    return NextResponse.json(
      { error: "title not earned", earnedTitles: Array.from(earnedTitles) },
      { status: 403 },
    );
  }

  await db.update(users).set({ pinnedTitle: title }).where(eq(users.id, userId));
  return NextResponse.json({ pinnedTitle: title });
}
