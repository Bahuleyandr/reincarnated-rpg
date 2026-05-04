/**
 * GET /api/world/year/[n] — public year archive read.
 * Phase 7 Day 62.
 */
import { eq, asc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  branchDecisions,
  worldVotes,
  yearEndings,
} from "@/lib/db/schema";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ n: string }> },
) {
  const { n } = await params;
  const year = Number.parseInt(n, 10);
  if (!Number.isInteger(year) || year < 1) {
    return NextResponse.json({ error: "invalid_year" }, { status: 400 });
  }

  const [ending] = await db
    .select()
    .from(yearEndings)
    .where(eq(yearEndings.year, year))
    .limit(1);

  // Branches and votes don't carry year directly — they live by
  // chapter id, and 48 chapters per year. Year N spans
  // chapter (N-1)*48+1 .. N*48.
  const startCh = (year - 1) * 48 + 1;
  const endCh = year * 48;

  const branches = (
    await db
      .select()
      .from(branchDecisions)
      .orderBy(asc(branchDecisions.id))
  ).filter(
    (b) => b.chapterId >= startCh && b.chapterId <= endCh,
  );
  const votes = (
    await db
      .select()
      .from(worldVotes)
      .orderBy(asc(worldVotes.id))
  ).filter((v) => v.chapterId >= startCh && v.chapterId <= endCh);

  return NextResponse.json({
    year,
    ending: ending
      ? {
          id: ending.endingId,
          label: ending.endingLabel,
          resolvedAtMs: ending.resolvedAt.getTime(),
          resolutionData: ending.resolutionData,
        }
      : null,
    branches: branches.map((b) => ({
      id: b.id,
      chapterId: b.chapterId,
      question: b.question,
      resolvedPath: b.resolvedPath,
    })),
    votes: votes.map((v) => ({
      id: v.id,
      chapterId: v.chapterId,
      question: v.question,
      winningOption: v.winningOption,
    })),
  });
}
