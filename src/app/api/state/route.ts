import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { arcTagline } from "@/lib/game/arc-routing";
import { resolveSessionContext } from "@/lib/game/campaign-context";
import { loadForm, loadLocation } from "@/lib/game/content";
import { readLog, rowToEvent } from "@/lib/game/events";
import { loadProjection } from "@/lib/game/projection";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { log } from "@/lib/util/log";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "no session" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified || !verified.sessionId) {
    return NextResponse.json(
      { error: "no active session" },
      { status: 401 },
    );
  }
  const sessionId = verified.sessionId;

  try {
    const ctx = await resolveSessionContext(db, sessionId);
    const form = loadForm(ctx.formId);
    const location = loadLocation(ctx.locationId);
    const starterFormState = ctx.starterBonus
      ? { [ctx.starterBonus.field]: ctx.starterBonus.value }
      : undefined;
    const projection = await loadProjection(db, sessionId, form, location, {
      reincarnatedAs: ctx.reincarnatedAs,
      starterFormState,
    });

    const events = await readLog(db, sessionId);
    const narrations = events
      .map(rowToEvent)
      .filter((e) => e.kind === "narration.emitted")
      .map((e) => (e as { kind: "narration.emitted"; text: string }).text);

    // Phase 5.5 Day 36-37: surface tutorial flag so the UI can
    // render TutorialHint without a separate fetch.
    const { sessions: sessTbl } = await import("@/lib/db/schema");
    const { eq: eqOp } = await import("drizzle-orm");
    const [sessionRow] = await db
      .select({ isTutorial: sessTbl.isTutorial })
      .from(sessTbl)
      .where(eqOp(sessTbl.id, sessionId))
      .limit(1);
    const isTutorial = !!sessionRow?.isTutorial;
    return NextResponse.json({
      sessionId,
      projection,
      narrations,
      // For the recap "save this run" link — only show if anon.
      hasAccount: !!verified.userId,
      // For the epitaph form (Phase 5.5 Day 30) — null on anon
      // sessions that haven't claimed a campaign yet.
      campaignId: ctx.campaignId ?? null,
      reincarnatedAs: ctx.reincarnatedAs,
      formId: ctx.formId,
      locationId: ctx.locationId,
      arcId: ctx.arcId,
      arcTagline: arcTagline(ctx.arcId),
      isTutorial,
    });
  } catch (err) {
    log.error("state.failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
