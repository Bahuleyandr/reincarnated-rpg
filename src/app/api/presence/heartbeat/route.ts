/**
 * POST /api/presence/heartbeat — bumps sessions.last_active_at to NOW
 * for the session in the cookie. Called by /play every ~30s.
 *
 * Idempotent. Cheap. No body. Returns ok:true or 401.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { heartbeat } from "@/lib/game/presence";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "no session" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.sessionId) {
    return NextResponse.json({ error: "no session" }, { status: 401 });
  }
  await heartbeat(db, verified.sessionId);
  return NextResponse.json({ ok: true });
}
