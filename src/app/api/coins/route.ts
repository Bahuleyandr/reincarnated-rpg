/**
 * GET /api/coins — current coin balance for the requesting session.
 *
 * Logged-in users hit users.coins (cross-run). Anonymous sessions hit
 * sessions.coins (ephemeral, lost on logout unless they register).
 *
 * The `scope` field tells the UI which kind of purse this is — anon
 * gets a "log in to keep these" tooltip in CoinBadge. Phase 5 Day 18-19.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getCoins } from "@/lib/economy/coins";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "no session" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.sessionId) {
    return NextResponse.json({ error: "no session" }, { status: 401 });
  }
  const userId = verified.userId ?? null;
  const coins = await getCoins(db, {
    userId: userId ?? undefined,
    sessionId: userId ? undefined : verified.sessionId,
  });
  return NextResponse.json({
    coins,
    scope: userId ? "user" : "session",
  });
}
