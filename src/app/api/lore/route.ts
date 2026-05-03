/**
 * GET /api/lore — public, no auth.
 *
 * The world's canonical chronicle — every entry that the lore
 * judge promoted from a player's run. The /meta page renders this
 * as a chronicle feed, and so might future content showing the
 * world's grand history at a glance.
 *
 * Query: ?limit=N (default 25, max 100), ?category=cult|wyrm-event|...
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { recentLore } from "@/lib/lore/store";
import { cached } from "@/lib/util/cache";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.max(
    1,
    Math.min(100, Number(url.searchParams.get("limit") ?? "25")),
  );
  const category = url.searchParams.get("category");
  // 60s TTL — lore changes only when the lore judge promotes a
  // run, which is sparse (10-20% pass pre-filter, 30-50% of those
  // pass the judge). Public /meta page polls every 30s and the
  // /api/character page reads it; both are fine with 60s staleness.
  const lore = await cached(`lore:list:${limit}`, 60_000, () =>
    recentLore(db, limit),
  );
  const filtered = category
    ? lore.filter((l) => l.category === category)
    : lore;
  return NextResponse.json({
    lore: filtered.map((l) => ({
      id: l.id,
      summary: l.summary,
      prose: l.prose,
      salience: l.salience,
      category: l.category,
      tags: l.tags,
      sourceFormId: l.sourceFormId,
      sourceLocationId: l.sourceLocationId,
      sourcePhase: l.sourcePhase,
      createdAt: l.createdAt,
    })),
  });
}
