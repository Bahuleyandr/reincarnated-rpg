import { and, eq, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { campaigns, sessions, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/session/auth";
import {
  mintCookie,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_TTL_DAYS,
  verifyCookie,
} from "@/lib/session/cookie";
import { env } from "@/lib/util/env";
import { log } from "@/lib/util/log";
import { uuidv7 } from "@/lib/util/uuidv7";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; username?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!email || !username || password.length < 8) {
    return NextResponse.json(
      {
        error:
          "email + username + password (≥8 chars) required",
      },
      { status: 400 },
    );
  }

  const existingByEmail = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existingByEmail.length > 0) {
    return NextResponse.json({ error: "email taken" }, { status: 409 });
  }
  const existingByName = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (existingByName.length > 0) {
    return NextResponse.json({ error: "username taken" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const userId = uuidv7();
  // Start the new player at the BLESSED-free cap (40) so the
  // first-week experience feels generous from minute one. The
  // blessing decays back to the free baseline after 7 days.
  const { effectiveTier, getTier } = await import("@/lib/energy/tiers");
  const blessedFree = effectiveTier(getTier("free"), new Date()).tier;
  await db.insert(users).values({
    id: userId,
    email,
    username,
    passwordHash,
    energy: blessedFree.max,
  });

  // Anon-claim: if the request carried an anon session cookie and that
  // session is unattached, hand it to the new user as their first
  // campaign. This preserves the run the player just played.
  const claim = await maybeClaimAnonSession(req, userId);

  const cookiePayload = {
    userId,
    ...(claim ? { sessionId: claim.sessionId } : {}),
  };
  const token = await mintCookie(cookiePayload);
  log.info("auth.register", {
    userId,
    claimedSession: claim?.sessionId,
    claimedCampaign: claim?.campaignId,
  });

  const res = NextResponse.json({
    user: { id: userId, email, username },
    claimed: claim,
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

async function maybeClaimAnonSession(
  req: NextRequest,
  userId: string,
): Promise<{ sessionId: string; campaignId: string } | null> {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;
  const verified = await verifyCookie(cookie);
  if (!verified?.sessionId || verified.userId) return null;
  // Only claim a session that exists and isn't already attached to a
  // campaign (prevents stealing somebody else's session via cookie).
  const rows = await db
    .select({
      id: sessions.id,
      formId: sessions.formId,
      locationId: sessions.locationId,
      reincarnatedAs: sessions.reincarnatedAs,
      status: sessions.status,
      campaignId: sessions.campaignId,
    })
    .from(sessions)
    .where(
      and(eq(sessions.id, verified.sessionId), isNull(sessions.campaignId)),
    )
    .limit(1);
  const session = rows[0];
  if (!session) return null;

  const campaignId = uuidv7();
  // Title from reincarnatedAs if the anon player declared one; otherwise
  // the legacy "First run" label so untyped slime starts read clean.
  const claimTitle =
    session.reincarnatedAs && session.reincarnatedAs.trim().length > 0
      ? session.reincarnatedAs.length > 60
        ? session.reincarnatedAs.slice(0, 60) + "…"
        : session.reincarnatedAs
      : "First run";
  await db.insert(campaigns).values({
    id: campaignId,
    userId,
    title: claimTitle,
    formId: session.formId,
    locationId: session.locationId,
    reincarnatedAs: session.reincarnatedAs,
    status:
      session.status === "won"
        ? "completed"
        : session.status === "active"
          ? "active"
          : "abandoned",
  });
  await db
    .update(sessions)
    .set({ campaignId })
    .where(eq(sessions.id, session.id));

  return { sessionId: session.id, campaignId };
}
