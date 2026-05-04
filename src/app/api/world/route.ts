/**
 * GET /api/world — public, no auth.
 *
 * Surfaces the active weekly theme + the catalog so the UI can
 * show the current world-mood and (in /god) let admins pin a
 * specific theme.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { ensureLongWyrmExists, getCurrentArc } from "@/lib/meta/long-wyrm";
import { cached } from "@/lib/util/cache";
import {
  activeTheme,
  isoWeekNumber,
  WEEKLY_THEMES,
} from "@/lib/world/weekly-theme";

export async function GET() {
  // 60s TTL — theme is deterministic by week + admin override; reads
  // are public and frequent.
  const payload = await cached("world:active-theme", 60_000, async () => {
    await ensureLongWyrmExists(db);
    const arc = await getCurrentArc(db);
    const theme = activeTheme(arc);
    return { arc, theme };
  });

  const { arc, theme } = payload;
  const override = (arc?.meta as { themeOverride?: string } | null)
    ?.themeOverride;

  // Wyrm raid status (Phase 3 Day 13). hp/hp_max present from
  // migration 0031; fellCount tracked in meta for "this is the
  // Nth wyrm" texture.
  const arcAny = arc as
    | (typeof arc & {
        hp?: number;
        hpMax?: number;
        meta?: { fellCount?: number; lastFellAt?: string } | null;
      })
    | null;
  const wyrm = arcAny
    ? {
        hp: arcAny.hp ?? 1000,
        hpMax: arcAny.hpMax ?? 1000,
        phase: arcAny.phase,
        phaseLabel: arcAny.phaseLabel,
        progress: arcAny.progress,
        progressMax: 1000,
        contributorCount: arcAny.contributorCount,
        fellCount: arcAny.meta?.fellCount ?? 0,
        lastFellAt: arcAny.meta?.lastFellAt ?? null,
      }
    : null;

  return NextResponse.json({
    activeTheme: {
      id: theme.id,
      label: theme.label,
      description: theme.description,
      ambientFlavor: theme.ambientFlavor,
      feedMultiplier: theme.feedMultiplier,
      starveMultiplier: theme.starveMultiplier,
      turnCap: theme.turnCap,
    },
    overrideActive: !!override,
    isoWeek: isoWeekNumber(new Date()),
    wyrm,
    catalog: WEEKLY_THEMES.map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
    })),
  });
}
