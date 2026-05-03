/**
 * GET /api/god — admin-only summary view.
 *
 * Returns the meta-arc state, the live form distribution, the recent
 * contributions feed, the current player count, and a list of the
 * user's per-option weight overrides (when persisted; v1 reads
 * defaults). Admins use this to decide what to nudge.
 */
import { sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import {
  liveDistribution,
} from "@/lib/game/reincarnation-picker";
import {
  ensureLongWyrmExists,
  getCurrentArc,
  PHASES,
  recentContributions,
} from "@/lib/meta/long-wyrm";
import { requireAdmin } from "@/lib/session/admin";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await ensureLongWyrmExists(db);
  const arc = await getCurrentArc(db);
  const distribution = await liveDistribution(db);
  const contribs = await recentContributions(db, 25);

  // Live player count — sessions active in the last 90s.
  const cutoff = new Date(Date.now() - 90_000);
  const [live] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sessions)
    .where(sql`${sessions.lastActiveAt} >= ${cutoff}`);

  return NextResponse.json({
    admin: { username: admin.username },
    arc,
    phases: PHASES,
    distribution: Object.fromEntries(distribution),
    livePlayers: live?.n ?? 0,
    recentContributions: contribs,
  });
}
