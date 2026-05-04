/**
 * GET /api/world/codex — public year-to-date summary for the
 * Catch-Up Codex (Phase 7 Day 58).
 *
 * Aggregates: current chapter, resolved branches so far, vote
 * outcomes, faction standings, year endings (history). Cheap
 * single-query reads + a 5-minute cache so a popular landing
 * page can serve many viewers.
 */
import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  branchDecisions,
  factions,
  worldVotes,
  yearEndings,
} from "@/lib/db/schema";
import { getCalendar } from "@/lib/story/calendar";
import { cached } from "@/lib/util/cache";

export async function GET() {
  const payload = await cached("world:codex", 5 * 60_000, async () => {
    const cal = await getCalendar(db);
    const branches = await db
      .select({
        id: branchDecisions.id,
        chapterId: branchDecisions.chapterId,
        question: branchDecisions.question,
        resolvedPath: branchDecisions.resolvedPath,
        resolvedAt: branchDecisions.resolvedAt,
      })
      .from(branchDecisions);
    const votes = await db
      .select({
        id: worldVotes.id,
        chapterId: worldVotes.chapterId,
        question: worldVotes.question,
        winningOption: worldVotes.winningOption,
        resolvedAt: worldVotes.resolvedAt,
      })
      .from(worldVotes);
    const factionRows = await db
      .select({
        id: factions.id,
        label: factions.label,
        memberCount: factions.memberCount,
        cumulativeContribution: factions.cumulativeContribution,
        active: factions.active,
      })
      .from(factions)
      .orderBy(desc(factions.cumulativeContribution));
    const endings = await db
      .select({
        year: yearEndings.year,
        endingId: yearEndings.endingId,
        endingLabel: yearEndings.endingLabel,
        resolvedAt: yearEndings.resolvedAt,
      })
      .from(yearEndings)
      .orderBy(desc(yearEndings.year));
    return {
      currentChapter: {
        book: cal.row.currentBook,
        chapter: cal.row.currentChapter,
        chapterInBook: cal.chapter.chapterInBook,
        year: cal.row.year,
        title: cal.chapter.title,
        theme: cal.chapter.theme,
      },
      branches: branches.map((b) => ({
        id: b.id,
        chapterId: b.chapterId,
        question: b.question,
        resolvedPath: b.resolvedPath,
        resolvedAtMs: b.resolvedAt?.getTime() ?? null,
      })),
      votes: votes.map((v) => ({
        id: v.id,
        chapterId: v.chapterId,
        question: v.question,
        winningOption: v.winningOption,
        resolvedAtMs: v.resolvedAt?.getTime() ?? null,
      })),
      factions: factionRows,
      yearHistory: endings,
    };
  });
  return NextResponse.json(payload);
}
