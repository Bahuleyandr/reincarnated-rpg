/**
 * GET /api/god/economy — admin-only economy snapshot.
 *
 * Returns:
 *   - today's coin inflow / outflow / net
 *   - top-5 sources by absolute amount
 *   - last-7-days roll for a sparkline
 *   - total coins in circulation across all users + sessions
 *
 * Phase 5 Day 26.
 */
import { sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import { readDailyEconomy } from "@/lib/economy/telemetry";
import { requireAdmin } from "@/lib/session/admin";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Today's snapshot.
  const today = await readDailyEconomy(db);

  // Last 7 days inflow / outflow rollup (one date per row).
  const recentRows = (await db.execute(sql`
    SELECT date::text AS date,
           SUM(CASE WHEN total_amount > 0 THEN total_amount ELSE 0 END)::bigint AS inflow,
           SUM(CASE WHEN total_amount < 0 THEN total_amount ELSE 0 END)::bigint AS outflow,
           SUM(total_amount)::bigint AS net
    FROM coin_flow_daily
    WHERE date >= (CURRENT_DATE - INTERVAL '6 days')
    GROUP BY date
    ORDER BY date DESC
  `)) as unknown as Array<{
    date: string;
    inflow: number | string;
    outflow: number | string;
    net: number | string;
  }>;

  // Total coins in circulation = sum of users.coins + sessions.coins
  // for active sessions (anon purses on dead sessions don't count).
  const [userTotal] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${users.coins}), 0)::bigint`,
    })
    .from(users);
  const [sessionTotal] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${sessions.coins}), 0)::bigint`,
    })
    .from(sessions)
    .where(sql`${sessions.status} = 'active'`);

  return NextResponse.json({
    admin: { username: admin.username },
    today: {
      date: today.date,
      inflow: today.inflow,
      outflow: today.outflow,
      net: today.net,
      topSources: today.topSources,
    },
    recent: recentRows.map((r) => ({
      date: r.date,
      inflow: Number(r.inflow),
      outflow: Number(r.outflow),
      net: Number(r.net),
    })),
    circulation: {
      userTotal: Number(userTotal?.total ?? 0),
      sessionTotal: Number(sessionTotal?.total ?? 0),
      grandTotal:
        Number(userTotal?.total ?? 0) + Number(sessionTotal?.total ?? 0),
    },
  });
}
