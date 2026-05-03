/**
 * GET /api/energy — current energy view for the requesting session.
 *
 * Returns refilled state (applies regen on read; persists if it
 * changed). Logged-in users hit users.* storage; anon sessions hit
 * sessions.* storage.
 *
 * Loading the page (which calls this endpoint) counts as a daily
 * "login" — the streak claim runs here, so a returning player sees
 * their bonus before they take a turn. The `dailyGrant` field is
 * non-null exactly when this call awarded the bonus; the EnergyBar
 * uses it to flash a celebration.
 *
 * Shape:
 *   {
 *     energy, max, tierId, effectiveTierId, tierLabel,
 *     regenIntervalMs, nextRegenMs, fullAtMs, turnsPerDay,
 *     blessing: { id, label, description, expiresAtMs } | null,
 *     streak: { count: 0..5, max: 5 },
 *     dailyGrant: { streakBefore, streakAfter, bonusEnergy, reachedCap } | null
 *   }
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getEnergyView } from "@/lib/energy/state";
import { MAX_STREAK } from "@/lib/energy/streak";
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
    tierId: view.tierId, // STORED tier id (e.g. 'free' even when blessed)
    effectiveTierId: view.tier.id,
    tierLabel: view.tier.label,
    regenIntervalMs: view.tier.regenIntervalMs,
    nextRegenMs: view.nextRegenMs,
    fullAtMs: view.fullAtMs,
    turnsPerDay: turnsPerDay(view.tier),
    blessing: view.blessing
      ? {
          id: view.blessing.id,
          label: view.blessing.label,
          description: view.blessing.description,
          expiresAtMs: view.blessingExpiresAtMs,
        }
      : null,
    streak: {
      count: view.streak.count,
      max: MAX_STREAK,
    },
    dailyGrant: view.dailyGrant,
  });
}
