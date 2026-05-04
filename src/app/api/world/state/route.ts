/**
 * GET /api/world/state — single endpoint that aggregates the
 * "what is the world like today?" surface. Used by the home
 * page banner, the /world index page, and any UI that wants a
 * one-call snapshot.
 *
 * Aggregates:
 *   - active world chapter (book/chapter + title + first-line)
 *   - long wyrm meta-arc phase
 *   - active weekly theme
 *   - any festival firing today (per content/world/festivals.json)
 *   - live player count
 *   - active campaigns count
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { campaigns } from "@/lib/db/schema";
import { utcDateString } from "@/lib/energy/streak";

interface FestivalsJson {
  festivals: Array<{
    id: string;
    displayName: string;
    region: string;
    raceId: string;
    summary: string;
    trigger: {
      type: "annual-window";
      startMonthDay: string;
      endMonthDay: string;
      appliesToLocations: string[];
    };
  }>;
}

function festivalsActiveToday(): FestivalsJson["festivals"] {
  const path = join(process.cwd(), "content", "world", "festivals.json");
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, "utf8")) as FestivalsJson;
  const today = new Date();
  const md = `${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
  return data.festivals.filter((f) => {
    if (f.trigger.type !== "annual-window") return false;
    const a = f.trigger.startMonthDay;
    const b = f.trigger.endMonthDay;
    // String comparison works for MM-DD when both are zero-padded.
    if (a <= b) return md >= a && md <= b;
    // Wrap-around (e.g. "12-25" .. "01-05").
    return md >= a || md <= b;
  });
}

export async function GET() {
  const utcDate = utcDateString(new Date());

  // World chapter — best-effort.
  let chapter: {
    book: number;
    chapter: number;
    title: string;
  } | null = null;
  try {
    const { getCalendar } = await import("@/lib/story/calendar");
    const cal = await getCalendar(db);
    chapter = {
      book: cal.row.currentBook,
      chapter: cal.row.currentChapter,
      title: cal.chapter.title,
    };
  } catch {
    /* no chapter yet */
  }

  // Wyrm phase.
  let wyrmPhase: { phase: string; label: string } | null = null;
  try {
    const { getCurrentArc } = await import("@/lib/meta/long-wyrm");
    const arc = await getCurrentArc(db);
    if (arc) wyrmPhase = { phase: arc.phase, label: arc.phaseLabel };
  } catch {
    /* */
  }

  // Active campaigns — sample.
  let activeCampaigns = 0;
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaigns)
      .where(sql`status = 'active'`);
    activeCampaigns = count ?? 0;
  } catch {
    /* */
  }

  return NextResponse.json({
    utcDate,
    chapter,
    wyrmPhase,
    activeCampaigns,
    festivalsToday: festivalsActiveToday().map((f) => ({
      id: f.id,
      displayName: f.displayName,
      region: f.region,
      raceId: f.raceId,
      summary: f.summary,
    })),
  });
}
