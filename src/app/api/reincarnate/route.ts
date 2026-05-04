/**
 * GET /api/reincarnate — what the God of the new world is offering
 * this player today.
 *
 * Public — both anon visitors (landing page picker) and logged-in
 * users (post-register, between campaigns) get an offer.
 *
 * Optional ?n=N (default 6) controls the offer size. Optional
 * ?seed=SEED is honored only in dev / test (not yet wired) — for
 * production the picker uses crypto randomness and live distribution.
 *
 * Returns:
 *   { options: PickerOption[], totalActive: N, byForm: { formId -> count } }
 *
 * The UI shows the options in a "the God of the new world asks…"
 * dialog. Saturated options carry a `saturated: true` flag so the UI
 * can render a subtle "many already walk that path" hint and emphasize
 * rare alternatives with their starter bonus.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { offerReincarnations } from "@/lib/game/reincarnation-picker";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const n = Math.max(3, Math.min(12, Number(url.searchParams.get("n") ?? "6")));
  // Phase 5.5 Day 29: thread the caller's userId so the picker can
  // filter cooling forms. Anon visitors send no cookie / non-user
  // cookie → undefined userId → no cooldowns applied.
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  let userId: string | undefined;
  if (cookie) {
    const verified = await verifyCookie(cookie);
    userId = verified?.userId ?? undefined;
  }
  const offer = await offerReincarnations(db, { n, userId });
  return NextResponse.json(offer);
}
