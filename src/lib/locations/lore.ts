/**
 * Location-tied lore reads — Phase 5.5 Day 30.
 *
 * Surface custom epitaphs (and future location-tied lore — player
 * notes from Day 32, etc.) from the world_lore ledger filtered by
 * sourceLocationId + category. The 24h-public-delay (Day 15)
 * carries forward — entries created in the last 24h aren't returned.
 */
import { and, desc, eq, lt, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { worldLore } from "../db/schema";

const HORIZON_MS = 24 * 60 * 60 * 1000;

export interface LocationLore {
  id: string;
  summary: string;
  prose: string | null;
  category: string;
  salience: number;
  createdAtMs: number;
  publicAtMs: number;
  sourceFormId: string | null;
}

/**
 * Recent location-tied lore (default: epitaphs only). Excludes
 * admin-redacted entries and respects the 24h public-delay.
 */
export async function recentLocationLore(
  db: Db,
  locationId: string,
  opts: { category?: string; limit?: number } = {},
): Promise<LocationLore[]> {
  const horizon = new Date(Date.now() - HORIZON_MS);
  const category = opts.category ?? "epitaph";
  const limit = Math.max(1, Math.min(20, opts.limit ?? 5));
  const rows = await db
    .select({
      id: worldLore.id,
      summary: worldLore.summary,
      prose: worldLore.prose,
      category: worldLore.category,
      salience: worldLore.salience,
      createdAt: worldLore.createdAt,
      sourceFormId: worldLore.sourceFormId,
    })
    .from(worldLore)
    .where(
      and(
        eq(worldLore.sourceLocationId, locationId),
        eq(worldLore.category, category),
        eq(worldLore.adminRedacted, false),
        lt(worldLore.createdAt, horizon),
        sql`(${worldLore.expiresAt} IS NULL OR ${worldLore.expiresAt} > now())`,
      ),
    )
    .orderBy(desc(worldLore.salience), desc(worldLore.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    summary: r.summary,
    prose: r.prose,
    category: r.category ?? "epitaph",
    salience: r.salience,
    createdAtMs: r.createdAt.getTime(),
    publicAtMs: r.createdAt.getTime() + HORIZON_MS,
    sourceFormId: r.sourceFormId,
  }));
}
