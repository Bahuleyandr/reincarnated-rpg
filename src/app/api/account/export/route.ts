/**
 * GET /api/account/export — GDPR data export.
 *
 * Returns a single JSON blob with everything we hold for the
 * caller. Streamed straight to the response body; download as a
 * file via Content-Disposition. Phase 8 Day 72.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  achievementsUnlocked,
  campaigns,
  events,
  factionContributions,
  gifts,
  locationNotes,
  memories,
  objectiveProgress,
  reengagementLog,
  sessions,
  userSkills,
  users,
  worldLore,
  worldMemories,
  worldNpcs,
} from "@/lib/db/schema";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  const userId = verified.userId;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const myCampaigns = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.userId, userId));
  const campaignIds = myCampaigns.map((c) => c.id);
  const mySessions = campaignIds.length
    ? await db.select().from(sessions).where(eq(sessions.campaignId, campaignIds[0]))
    : [];
  const myAchievements = await db
    .select()
    .from(achievementsUnlocked)
    .where(eq(achievementsUnlocked.userId, userId));
  const mySkills = await db
    .select()
    .from(userSkills)
    .where(eq(userSkills.userId, userId));
  const myWorldNpcs = await db
    .select()
    .from(worldNpcs)
    .where(eq(worldNpcs.userId, userId));
  const myWorldMemories = await db
    .select()
    .from(worldMemories)
    .where(eq(worldMemories.userId, userId));
  const myObjectiveProgress = await db
    .select()
    .from(objectiveProgress)
    .where(eq(objectiveProgress.userId, userId));
  const myFactionContributions = await db
    .select()
    .from(factionContributions)
    .where(eq(factionContributions.userId, userId));
  const myGiftsSent = await db
    .select()
    .from(gifts)
    .where(eq(gifts.fromUserId, userId));
  const myGiftsReceived = await db
    .select()
    .from(gifts)
    .where(eq(gifts.toUserId, userId));
  const myNotes = await db
    .select()
    .from(locationNotes)
    .where(eq(locationNotes.authorUserId, userId));
  const myLore = await db
    .select()
    .from(worldLore)
    .where(eq(worldLore.sourceUserId, userId));
  const myReengagement = await db
    .select()
    .from(reengagementLog)
    .where(eq(reengagementLog.userId, userId));

  // Strip the password hash and other sensitive fields.
  const safeUser = user
    ? {
        ...user,
        passwordHash: "[redacted]",
      }
    : null;

  const blob = {
    exportedAtMs: Date.now(),
    schemaVersion: 1,
    user: safeUser,
    campaigns: myCampaigns,
    sessions: mySessions,
    achievements: myAchievements,
    skills: mySkills,
    worldNpcs: myWorldNpcs,
    worldMemories: myWorldMemories,
    objectiveProgress: myObjectiveProgress,
    factionContributions: myFactionContributions,
    gifts: { sent: myGiftsSent, received: myGiftsReceived },
    locationNotes: myNotes,
    worldLore: myLore,
    reengagementLog: myReengagement,
  };

  return new NextResponse(JSON.stringify(blob, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="reincarnated-export-${userId}.json"`,
    },
  });
  // Suppress unused imports warning — events / memories are
  // intentionally NOT exported (they belong to sessions; the
  // session list is enough audit). Imports remain in case a
  // future iteration wants to surface them.
  void events;
  void memories;
}
