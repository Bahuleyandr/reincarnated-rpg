/**
 * GET  /api/daily — today's challenge + your status (if logged in) +
 *                   today's leaderboard.
 * POST /api/daily — start today's daily run (logged-in only). Returns
 *                   the sessionId so the UI can route to /play.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  dailyLeaderboard,
  getDailyStatus,
  pickDailyChallenge,
  reserveDailyRun,
  userDailyHistory,
} from "@/lib/daily/challenge";
import { utcDateString } from "@/lib/energy/streak";
import { createSession } from "@/lib/game/session";
import {
  mintCookie,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_TTL_DAYS,
  verifyCookie,
} from "@/lib/session/cookie";
import { env } from "@/lib/util/env";

export async function GET(req: NextRequest) {
  const utcDate = utcDateString(new Date());
  const challenge = pickDailyChallenge(utcDate);
  const leaderboard = await dailyLeaderboard(db, { utcDate });

  // Status + history are user-scoped — anon callers get null.
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const verified = cookie ? await verifyCookie(cookie) : null;
  let status = null;
  let history: Array<{
    utcDate: string;
    formId: string;
    status: string;
    turnCount: number;
    score: number;
  }> = [];
  if (verified?.userId) {
    const s = await getDailyStatus(db, {
      userId: verified.userId,
      utcDate,
    });
    status = s.run;
    history = await userDailyHistory(db, {
      userId: verified.userId,
      days: 14,
    });
  }

  return NextResponse.json({
    utcDate,
    challenge: {
      formId: challenge.formId,
      locationId: challenge.locationId,
      // The seed is a determinant of "today" but isn't player-
      // facing — surfacing it would invite spoilers from anyone
      // reading the API directly. So we redact it.
      seedHash: challenge.seed % 1_000_000,
    },
    yourRun: status,
    history,
    leaderboard,
  });
}

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const verified = cookie ? await verifyCookie(cookie) : null;
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }

  const utcDate = utcDateString(new Date());
  const challenge = pickDailyChallenge(utcDate);

  // First check: has the player already started today's daily?
  // (Idempotent UX — re-clicks return the existing session.)
  const existing = await getDailyStatus(db, {
    userId: verified.userId,
    utcDate,
  });
  if (existing.run) {
    // Re-issue the cookie with the existing sessionId so the
    // /play route picks up the right session.
    const token = await mintCookie({
      userId: verified.userId,
      sessionId: existing.run.sessionId,
    });
    const res = NextResponse.json({
      ok: true,
      sessionId: existing.run.sessionId,
      challenge: {
        formId: challenge.formId,
        locationId: challenge.locationId,
      },
      resumed: true,
    });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: env().NODE_ENV === "production",
      maxAge: SESSION_COOKIE_TTL_DAYS * 24 * 60 * 60,
      path: "/",
    });
    return res;
  }

  // Mint a session with the challenge's pinned seed.
  const created = await createSession(db, challenge.formId, {
    locationId: challenge.locationId,
    seed: challenge.seed,
  });

  // Race-safe insert into daily_runs. If two requests fire at
  // once, only the first wins; the second gets already_played
  // and we throw away its session (cheap — just a row).
  const reserved = await reserveDailyRun(db, {
    userId: verified.userId,
    utcDate,
    sessionId: created.sessionId,
  });
  if (!reserved.ok) {
    if (reserved.error === "already_played") {
      // Race lost — re-read and return the canonical session.
      const fresh = await getDailyStatus(db, {
        userId: verified.userId,
        utcDate,
      });
      if (fresh.run) {
        const token = await mintCookie({
          userId: verified.userId,
          sessionId: fresh.run.sessionId,
        });
        const res = NextResponse.json({
          ok: true,
          sessionId: fresh.run.sessionId,
          challenge: {
            formId: challenge.formId,
            locationId: challenge.locationId,
          },
          resumed: true,
        });
        res.cookies.set(SESSION_COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: "strict",
          secure: env().NODE_ENV === "production",
          maxAge: SESSION_COOKIE_TTL_DAYS * 24 * 60 * 60,
          path: "/",
        });
        return res;
      }
    }
    return NextResponse.json(
      { error: reserved.error },
      { status: 500 },
    );
  }

  const token = await mintCookie({
    userId: verified.userId,
    sessionId: created.sessionId,
  });
  const res = NextResponse.json({
    ok: true,
    sessionId: created.sessionId,
    challenge: {
      formId: challenge.formId,
      locationId: challenge.locationId,
    },
    resumed: false,
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: env().NODE_ENV === "production",
    maxAge: SESSION_COOKIE_TTL_DAYS * 24 * 60 * 60,
    path: "/",
  });
  return res;
}
