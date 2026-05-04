/**
 * GET  /api/ascension — eligibility snapshot for the player.
 * POST /api/ascension — perform the one-shot ascension.
 *
 * Post-Phase-8.
 */
import { NextRequest, NextResponse } from "next/server";

import { ascend, checkEligibility } from "@/lib/ascension/eligibility";
import { db } from "@/lib/db/client";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  const state = await checkEligibility(db, verified.userId);
  return NextResponse.json(state);
}

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  const r = await ascend(db, { userId: verified.userId });
  if (!r.ok) {
    return NextResponse.json(r, { status: 400 });
  }
  return NextResponse.json(r);
}
