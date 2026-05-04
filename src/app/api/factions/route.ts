/**
 * GET  /api/factions — public list of factions + my pledge.
 * POST /api/factions/pledge — direct-API pledge (alt. to the tool path).
 *
 * Phase 7 Day 42-43.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { applyCoinDelta } from "@/lib/economy/coins";
import {
  getUserFaction,
  listFactions,
  PLEDGE_COST_COINS,
  pledgeFaction,
} from "@/lib/story/factions";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function GET(req: NextRequest) {
  const factions = await listFactions(db);
  let myPledge: { factionId: string; pledgedAtMs: number } | null = null;
  try {
    const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (cookie) {
      const verified = await verifyCookie(cookie);
      if (verified?.userId) {
        myPledge = await getUserFaction(db, verified.userId);
      }
    }
  } catch {
    /* ignore */
  }
  return NextResponse.json({ factions, myPledge });
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
  let body: { factionId?: unknown };
  try {
    body = (await req.json()) as { factionId?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof body.factionId !== "string") {
    return NextResponse.json({ error: "invalid_factionId" }, { status: 400 });
  }
  const r = await pledgeFaction(db, {
    userId: verified.userId,
    factionId: body.factionId,
  });
  if (!r.ok) {
    return NextResponse.json(r, { status: 400 });
  }
  // Direct-API path: charge coins ourselves (the tool path lets the
  // orchestrator's coin-event rollup handle this).
  await applyCoinDelta(
    db,
    { userId: verified.userId },
    -PLEDGE_COST_COINS,
  );
  return NextResponse.json(r);
}
