/**
 * POST /api/god/nudge — admin-only.
 *
 * Body: { delta?: number, setProgress?: number, setPhase?: string,
 *         reason?: string }
 *
 * Records an admin contribution to meta_contributions tagged
 * 'admin:<reason>' and updates meta_arcs accordingly. Bounded to the
 * same [0, 1000] window as player contributions; setPhase (when
 * supplied) snaps progress to the start of that phase's range.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { metaArcs, metaContributions } from "@/lib/db/schema";
import {
  ensureLongWyrmExists,
  getCurrentArc,
  LONG_WYRM_ID,
  PHASES,
  phaseForProgress,
} from "@/lib/meta/long-wyrm";
import { requireAdmin } from "@/lib/session/admin";
import { log } from "@/lib/util/log";
import { uuidv7 } from "@/lib/util/uuidv7";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: {
    delta?: number;
    setProgress?: number;
    setPhase?: string;
    reason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  await ensureLongWyrmExists(db);
  const cur = await getCurrentArc(db);
  if (!cur) {
    return NextResponse.json({ error: "no arc" }, { status: 500 });
  }

  let nextProgress = cur.progress;
  if (typeof body.setProgress === "number") {
    nextProgress = Math.max(0, Math.min(999, Math.floor(body.setProgress)));
  } else if (typeof body.setPhase === "string") {
    const target = PHASES.find((p) => p.phase === body.setPhase);
    if (!target) {
      return NextResponse.json(
        { error: `unknown phase: ${body.setPhase}` },
        { status: 400 },
      );
    }
    nextProgress = target.min;
  } else if (typeof body.delta === "number") {
    nextProgress = Math.max(
      0,
      Math.min(999, cur.progress + Math.floor(body.delta)),
    );
  } else {
    return NextResponse.json(
      { error: "specify one of delta / setProgress / setPhase" },
      { status: 400 },
    );
  }

  const nextPhase = phaseForProgress(nextProgress);
  const adminDelta = nextProgress - cur.progress;

  await db.insert(metaContributions).values({
    id: uuidv7(),
    arcId: LONG_WYRM_ID,
    userId: admin.userId,
    sessionId: null,
    campaignId: null,
    delta: adminDelta,
    reason: `admin:${body.reason ?? "manual-nudge"}`,
    prose: `[admin] ${admin.username} nudged the wyrm by ${adminDelta >= 0 ? "+" : ""}${adminDelta} (${body.reason ?? "no reason given"}).`,
    formId: null,
    locationId: null,
    phaseAtContribution: cur.phase,
  });

  await db
    .update(metaArcs)
    .set({
      progress: nextProgress,
      phase: nextPhase.phase,
      phaseLabel: nextPhase.label,
      updatedAt: new Date(),
    })
    .where(eq(metaArcs.id, LONG_WYRM_ID));

  log.info("god.nudge", {
    admin: admin.username,
    delta: adminDelta,
    progressBefore: cur.progress,
    progressAfter: nextProgress,
    phaseAfter: nextPhase.phase,
    reason: body.reason ?? null,
  });

  const after = await getCurrentArc(db);
  return NextResponse.json({ ok: true, arc: after });
}
