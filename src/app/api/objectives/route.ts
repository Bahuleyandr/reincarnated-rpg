/**
 * GET /api/objectives
 *
 * Returns the user's active daily + weekly objective progress, with
 * the catalog metadata joined so the UI doesn't need a second
 * fetch. Anon callers get 401.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { listObjectives } from "@/lib/objectives/catalog";
import { getActiveProgress } from "@/lib/objectives/runner";
import { periodKeyFor } from "@/lib/objectives/period";
import { SESSION_COOKIE_NAME, verifyCookie } from "@/lib/session/cookie";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const now = new Date();
  const rows = await getActiveProgress(db, verified.userId, now);
  const byCatalogKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    byCatalogKey.set(`${r.objectiveId}:${r.periodKey}`, r);
  }

  const dailyPK = periodKeyFor("daily", now);
  const weeklyPK = periodKeyFor("weekly", now);

  const projection = listObjectives().map((obj) => {
    const periodKey = obj.period === "weekly" ? weeklyPK : dailyPK;
    const row = byCatalogKey.get(`${obj.id}:${periodKey}`);
    return {
      id: obj.id,
      label: obj.label,
      description: obj.description,
      period: obj.period,
      target: obj.target,
      reward: obj.reward,
      progress: row?.progress ?? 0,
      completed: row?.completedAt !== null && row?.completedAt !== undefined,
      claimed: row?.rewardClaimedAt !== null && row?.rewardClaimedAt !== undefined,
    };
  });

  return NextResponse.json({
    daily: projection.filter((p) => p.period === "daily"),
    weekly: projection.filter((p) => p.period === "weekly"),
    periodKeys: { daily: dailyPK, weekly: weeklyPK },
  });
}
