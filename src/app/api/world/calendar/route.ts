/**
 * GET /api/world/calendar — current chapter snapshot.
 * Phase 7 Day 38.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCalendar } from "@/lib/story/calendar";

export async function GET() {
  const snap = await getCalendar(db);
  return NextResponse.json({
    book: snap.row.currentBook,
    chapter: snap.row.currentChapter,
    chapterInBook: snap.chapter.chapterInBook,
    year: snap.row.year,
    title: snap.chapter.title,
    theme: snap.chapter.theme,
    worldEvent: snap.chapter.worldEvent,
    chapterStartedAtMs: snap.row.chapterStartedAt.getTime(),
    nextAdvanceInMs: snap.nextAdvanceInMs,
  });
}
