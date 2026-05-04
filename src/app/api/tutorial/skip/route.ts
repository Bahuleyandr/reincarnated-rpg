/**
 * POST /api/tutorial/skip — exit the tutorial without completing it.
 * Phase 5.5 Day 36-37.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { skipTutorial } from "@/lib/tutorial/graduate";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId || !verified.sessionId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const r = await skipTutorial(db, verified.sessionId, verified.userId);
  return NextResponse.json(r);
}
