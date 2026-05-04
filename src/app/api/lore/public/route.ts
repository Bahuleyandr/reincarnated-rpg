/**
 * GET /api/lore/public
 *
 * Public read-only feed of world lore old enough (>24h) to surface.
 * Excludes admin-redacted entries. Cursor-paginated by created_at
 * DESC so newer-but-mature entries float to the top.
 *
 * Cache 5min — events are append-only and the 24h delay means a
 * 5min staleness on this read is invisible.
 */
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { worldLore } from "@/lib/db/schema";
import { cached } from "@/lib/util/cache";

const HORIZON_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 25;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const cursor = url.searchParams.get("cursor"); // ISO timestamp

  // Cache key includes the category filter and a cursor stub. Keep
  // the cache window short enough that a redaction lands within
  // ~5 minutes; long enough that bot crawlers don't spam the DB.
  const cacheKey = `lore:public:${category ?? "all"}:${cursor ?? "head"}`;
  const payload = await cached(cacheKey, 5 * 60 * 1000, async () => {
    const horizon = new Date(Date.now() - HORIZON_MS);
    const conditions = [
      eq(worldLore.adminRedacted, false),
      lt(worldLore.createdAt, horizon),
    ];
    if (category) {
      conditions.push(eq(worldLore.category, category));
    }
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        conditions.push(lt(worldLore.createdAt, cursorDate));
      }
    }
    const rows = await db
      .select({
        id: worldLore.id,
        summary: worldLore.summary,
        prose: worldLore.prose,
        category: worldLore.category,
        salience: worldLore.salience,
        tags: worldLore.tags,
        createdAt: worldLore.createdAt,
        sourceLocationId: worldLore.sourceLocationId,
        sourceFormId: worldLore.sourceFormId,
        sourcePhase: worldLore.sourcePhase,
      })
      .from(worldLore)
      .where(and(...conditions))
      .orderBy(desc(worldLore.createdAt))
      .limit(PAGE_SIZE);

    // Aggregate counts for the world-pulse ticker (yesterday vs
    // prior day). Same horizon math, no extra parameters.
    const oneDay = 24 * 60 * 60 * 1000;
    const ticker = (await db.$client`
      SELECT
        COUNT(*) FILTER (
          WHERE created_at < (now() - interval '24 hours')
            AND created_at >= (now() - interval '48 hours')
        ) AS recent_count,
        COUNT(*) FILTER (
          WHERE created_at < (now() - interval '48 hours')
            AND created_at >= (now() - interval '72 hours')
        ) AS prior_count
      FROM world_lore
      WHERE NOT admin_redacted
    `) as Array<{ recent_count: number; prior_count: number }>;
    void oneDay;

    return {
      entries: rows.map((r) => ({
        id: r.id,
        summary: r.summary,
        prose: r.prose,
        category: r.category,
        salience: r.salience,
        tags: r.tags,
        createdAtMs: r.createdAt.getTime(),
        publicAtMs: r.createdAt.getTime() + HORIZON_MS,
        sourceLocationId: r.sourceLocationId,
        sourceFormId: r.sourceFormId,
        sourcePhase: r.sourcePhase,
      })),
      pulse: {
        recentCount: Number(ticker[0]?.recent_count ?? 0),
        priorCount: Number(ticker[0]?.prior_count ?? 0),
      },
      delayHours: HORIZON_MS / (60 * 60 * 1000),
      pageSize: PAGE_SIZE,
      nextCursor:
        rows.length === PAGE_SIZE
          ? rows[rows.length - 1].createdAt.toISOString()
          : null,
    };
  });

  void sql;
  return NextResponse.json(payload);
}
