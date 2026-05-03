import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  loadBeatPack,
  loadForm,
  loadLocation,
} from "@/lib/game/content";
import { runTurn } from "@/lib/game/turn";
import { makeNarrator } from "@/lib/narrator";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { log } from "@/lib/util/log";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "no session" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified) {
    return NextResponse.json({ error: "invalid session" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const input =
    typeof (body as { input?: unknown })?.input === "string"
      ? (body as { input: string }).input
      : "";
  if (!input) {
    return NextResponse.json({ error: "missing input" }, { status: 400 });
  }

  try {
    const form = loadForm("lesser-slime");
    const location = loadLocation("collapsed-tunnel");
    const beatPack = loadBeatPack("survive-the-night");
    const narrator = makeNarrator({
      form,
      location,
      db,
      sessionId: verified.sessionId,
    });

    const result = await runTurn({
      db,
      sessionId: verified.sessionId,
      input,
      form,
      location,
      narrator,
      beatPack,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, status: result.projection.status },
        { status: 409 },
      );
    }

    return NextResponse.json({
      narration: result.narration,
      projection: result.projection,
      toolEvents: result.toolEvents,
      beatsFired: result.beatsFired,
    });
  } catch (err) {
    log.error("turn.failed", {
      sessionId: verified.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
