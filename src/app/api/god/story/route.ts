/**
 * GET /api/god/story — admin story dashboard data.
 * POST /api/god/story/advance — force-advance the calendar.
 *
 * Phase 7 Day 57.
 */
import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  branchDecisions,
  edicts,
  factions,
  worldEvents,
  worldVotes,
  yearEndings,
} from "@/lib/db/schema";
import { advanceCalendar } from "@/lib/story/advance";
import { getCalendar } from "@/lib/story/calendar";
import { requireAdmin } from "@/lib/session/admin";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const cal = await getCalendar(db);
  const branches = await db.select().from(branchDecisions);
  const votes = await db.select().from(worldVotes);
  const factionRows = await db
    .select()
    .from(factions)
    .orderBy(desc(factions.cumulativeContribution));
  const endings = await db
    .select()
    .from(yearEndings)
    .orderBy(desc(yearEndings.year));
  const recent = await db
    .select()
    .from(worldEvents)
    .orderBy(desc(worldEvents.createdAt))
    .limit(20);
  const activeEdicts = await db.select().from(edicts);

  return NextResponse.json({
    admin: { username: admin.username },
    calendar: {
      book: cal.row.currentBook,
      chapter: cal.row.currentChapter,
      chapterInBook: cal.chapter.chapterInBook,
      year: cal.row.year,
      title: cal.chapter.title,
      chapterStartedAtMs: cal.row.chapterStartedAt.getTime(),
      nextAdvanceInMs: cal.nextAdvanceInMs,
    },
    branches,
    votes,
    factions: factionRows,
    endings,
    edicts: activeEdicts,
    recentEvents: recent.map((r) => ({
      id: r.id,
      kind: r.kind,
      payload: r.payload,
      createdAtMs: r.createdAt.getTime(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Force-advance: backdate chapterStartedAt to make the next call
  // succeed. (Simpler than maintaining a separate force-flag in
  // advance.ts.)
  const { worldCalendar } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  await db
    .update(worldCalendar)
    .set({
      chapterStartedAt: new Date(0),
    })
    .where(eq(worldCalendar.id, 1));
  const r = await advanceCalendar(db);
  return NextResponse.json(r);
}
