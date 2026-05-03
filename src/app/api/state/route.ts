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
    const projection = await loadProjection(db, sessionId, form, location, {
      reincarnatedAs: ctx.reincarnatedAs,
    });

    const events = await readLog(db, sessionId);
    const narrations = events
      .map(rowToEvent)
      .filter((e) => e.kind === "narration.emitted")
      .map((e) => (e as { kind: "narration.emitted"; text: string }).text);

    return NextResponse.json({
      sessionId,
      projection,
      narrations,
      // For the recap "save this run" link — only show if anon.
      hasAccount: !!verified.userId,
      reincarnatedAs: ctx.reincarnatedAs,
      formId: ctx.formId,
      locationId: ctx.locationId,
      arcId: ctx.arcId,
      arcTagline: arcTagline(ctx.arcId),
    });
  } catch (err) {
    log.error("state.failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
