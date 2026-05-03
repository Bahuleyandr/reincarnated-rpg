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

export async function GET() {
  await ensureLongWyrmExists(db);
  const arc = await getCurrentArc(db);
  if (!arc) {
    return NextResponse.json({ error: "arc not seeded" }, { status: 500 });
  }
  const phase = phaseForProgress(arc.progress);
  const recent = await recentContributions(db, 25);
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
