/**
 * GET /api/energy — current energy view for the requesting session.
 *
 * Returns refilled state (applies regen on read; persists if it
 * changed). Logged-in users hit users.* storage; anon sessions hit
 * sessions.* storage.
 *
 * Shape:
 *   {
 *     energy: number,         // current
 *     max: number,            // tier max
 *     tierId: 'free'|'supporter'|'patron',
 *     tierLabel: string,
 *     regenIntervalMs: number,
 *     nextRegenMs: number,    // ms until next +1 (0 if at max)
 *     fullAtMs: number|null,  // wall-clock ms when energy hits max
 *     turnsPerDay: number,    // approximate
 *   }
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getEnergyView } from "@/lib/energy/state";
import { turnsPerDay } from "@/lib/energy/tiers";
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
  const view = await getEnergyView(db, {
    userId: verified.userId ?? null,
    sessionId: verified.sessionId,
  });
  if (!view) {
    return NextResponse.json({ error: "no state" }, { status: 404 });
  }
  return NextResponse.json({
    energy: view.energy,
    max: view.tier.max,
    tierId: view.tier.id,
    tierLabel: view.tier.label,
    regenIntervalMs: view.tier.regenIntervalMs,
    nextRegenMs: view.nextRegenMs,
    fullAtMs: view.fullAtMs,
    turnsPerDay: turnsPerDay(view.tier),
  });
}
