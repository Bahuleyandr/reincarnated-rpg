/**
 * GET /api/god/metrics — admin SLO board.
 *
 * Phase 8 Day 63. Pulls a small set of operational metrics from
 * existing tables — DAU (sessions active in last 24h), 7-day
 * retention (users who started in the last 7 days and have a
 * turn today), run completion rate (won + dead vs total ended),
 * faction balance, $/DAU. All cheap aggregate queries.
 */
import { sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { requireAdmin } from "@/lib/session/admin";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // DAU — sessions with last_active in last 24h.
  const [{ dau }] = (await db.execute(sql`
    SELECT COUNT(DISTINCT id)::int AS dau
    FROM sessions
    WHERE last_active_at >= now() - interval '24 hours'
  `)) as unknown as Array<{ dau: number }>;

  // 7-day retention: users who registered in the last 7d AND
  // have a session active in the last 24h.
  const [{ retained, cohort }] = (await db.execute(sql`
    SELECT
      COUNT(DISTINCT u.id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM sessions s
          WHERE s.campaign_id IN (SELECT id FROM campaigns WHERE user_id = u.id)
            AND s.last_active_at >= now() - interval '24 hours'
        )
      )::int AS retained,
      COUNT(DISTINCT u.id)::int AS cohort
    FROM users u
    WHERE u.created_at >= now() - interval '7 days'
  `)) as unknown as Array<{ retained: number; cohort: number }>;

  // Run completion rate: won/total-ended vs dead+capped/total-ended.
  const completion = (await db.execute(sql`
    SELECT status, COUNT(*)::int AS n
    FROM sessions
    WHERE status IN ('won', 'dead', 'capped')
      AND ended_at >= now() - interval '7 days'
    GROUP BY status
  `)) as unknown as Array<{ status: string; n: number }>;

  // Faction balance — pledges per faction.
  const factionBalance = (await db.execute(sql`
    SELECT id, member_count, cumulative_contribution
    FROM factions
    ORDER BY member_count DESC
  `)) as unknown as Array<{
    id: string;
    member_count: number;
    cumulative_contribution: number;
  }>;

  // $/DAU for the day: today's net coin spend vs DAU. Mostly
  // useful as a sanity check on economic balance.
  const [{ todayInflow, todayOutflow }] = (await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN total_amount > 0 THEN total_amount ELSE 0 END)::bigint, 0) AS "todayInflow",
      COALESCE(SUM(CASE WHEN total_amount < 0 THEN total_amount ELSE 0 END)::bigint, 0) AS "todayOutflow"
    FROM coin_flow_daily
    WHERE date = CURRENT_DATE
  `)) as unknown as Array<{ todayInflow: number | string; todayOutflow: number | string }>;

  return NextResponse.json({
    admin: { username: admin.username },
    asOfMs: Date.now(),
    dau: dau ?? 0,
    retention7d: {
      retained: retained ?? 0,
      cohort: cohort ?? 0,
      pct: cohort > 0 ? Math.round(((retained ?? 0) / cohort) * 1000) / 10 : 0,
    },
    runCompletion: completion.reduce(
      (out, c) => {
        out[c.status] = c.n;
        return out;
      },
      {} as Record<string, number>,
    ),
    factionBalance,
    economy: {
      todayInflow: Number(todayInflow),
      todayOutflow: Number(todayOutflow),
    },
  });
}
