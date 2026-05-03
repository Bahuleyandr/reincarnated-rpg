/**
 * GET /api/meta — public, no auth required.
 *
 * Returns the current state of the Long Wyrm meta-arc plus the most
 * recent contributions feed. Used by /meta and /play (small phase
 * indicator).
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  ensureLongWyrmExists,
  getCurrentArc,
  PHASES,
  phaseForProgress,
  recentContributions,
} from "@/lib/meta/long-wyrm";
import { cached } from "@/lib/util/cache";

export async function GET() {
  // 30s TTL — meta state changes only on end-of-run + admin nudges,
  // both of which are sparse. /play polls this every 30s; without
  // cache, with 100 active players we'd be running this query ~3.3
  // times/second; with cache, ~once every 30s globally.
  const payload = await cached("meta:state", 30_000, async () => {
    await ensureLongWyrmExists(db);
    const arc = await getCurrentArc(db);
    if (!arc) return { error: "arc not seeded" as const };
    const phase = phaseForProgress(arc.progress);
    const recent = await recentContributions(db, 25);
    return { arc, phase, recent };
  });

  if ("error" in payload) {
    return NextResponse.json({ error: payload.error }, { status: 500 });
  }
  const { arc, phase, recent } = payload;
  return NextResponse.json({
    arc: {
      id: arc.id,
      progress: arc.progress,
      progressMax: 1000,
      phase: arc.phase,
      phaseLabel: arc.phaseLabel,
      flavor: phase.ambientFlavor,
      totalFeeds: arc.totalFeeds,
      totalStarves: arc.totalStarves,
      contributorCount: arc.contributorCount,
      meta: arc.meta,
      updatedAt: arc.updatedAt,
    },
    phases: PHASES.map((p) => ({
      phase: p.phase,
      label: p.label,
      min: p.min,
      max: p.max,
      flavor: p.ambientFlavor,
    })),
    recentContributions: recent.map((c) => ({
      id: c.id,
      delta: c.delta,
      reason: c.reason,
      prose: c.prose,
      formId: c.formId,
      locationId: c.locationId,
      phaseAtContribution: c.phaseAtContribution,
      createdAt: c.createdAt,
    })),
  });
}
