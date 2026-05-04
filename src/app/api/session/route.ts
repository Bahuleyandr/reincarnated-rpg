/**
 * POST /api/session — create a new game session.
 *
 * Anon (no userId in cookie):
 *   - Body { reincarnatedAs?, locationId?, formId? } — all optional.
 *   - reincarnatedAs (free text) → server-derived formId via pickFormId
 *     (slime keyword → typed lesser-slime; everything else →
 *     generic-creature).
 *   - locationId is randomized from AVAILABLE_LOCATIONS unless explicitly
 *     provided (and valid).
 *   - The trio (formId, locationId, reincarnatedAs) is persisted on the
 *     sessions row so resolveSessionContext can read it later without
 *     needing a campaign.
 *
 * Logged-in (userId in cookie):
 *   - Body { campaignId? } — if present, the session is attached to
 *     that existing campaign (validated against ownership). Form +
 *     location come from the campaign.
 *   - If absent, a new campaign is auto-created with title
 *     "Run #<n>"; reincarnatedAs / locationId are NOT taken from the
 *     body here (logged-in users go through /api/campaigns POST for
 *     the open-ended creation flow).
 *   - Cookie is reissued with {userId, sessionId} so the play page
 *     can read state, AND the user stays signed in.
 */
import { randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { campaigns, sessions, users } from "@/lib/db/schema";
import { createSession } from "@/lib/game/session";
import {
  AVAILABLE_LOCATIONS,
  pickFormId,
  type LocationId,
} from "@/lib/game/types";
import {
  mintCookie,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_TTL_DAYS,
  verifyCookie,
} from "@/lib/session/cookie";
import { env } from "@/lib/util/env";
import { log } from "@/lib/util/log";
import { uuidv7 } from "@/lib/util/uuidv7";

function pickRandomLocation(): LocationId {
  const r = randomBytes(1)[0] % AVAILABLE_LOCATIONS.length;
  return AVAILABLE_LOCATIONS[r];
}

export async function POST(req: NextRequest) {
  try {
    const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const verified = cookie ? await verifyCookie(cookie) : null;
    const userId = verified?.userId ?? null;

    let body: {
      campaignId?: string;
      reincarnatedAs?: string;
      locationId?: string;
      formId?: string;
    } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      // tolerate empty / non-JSON bodies (the Begin button sends none)
    }

    let campaignId: string | null = null;
    let formId = "lesser-slime";
    let locationId: string = "collapsed-tunnel";
    let reincarnatedAs: string | null = null;

    if (userId) {
      if (body.campaignId) {
        // Validate ownership — read all the columns the play loop will
        // need so context resolution stays consistent.
        const rows = await db
          .select()
          .from(campaigns)
          .where(
            and(
              eq(campaigns.id, body.campaignId),
              eq(campaigns.userId, userId),
            ),
          )
          .limit(1);
        const c = rows[0];
        if (!c) {
          return NextResponse.json(
            { error: "campaign not found" },
            { status: 404 },
          );
        }
        campaignId = c.id;
        formId = c.formId;
        locationId = c.locationId;
        reincarnatedAs = c.reincarnatedAs ?? null;
      } else {
        // Auto-create a campaign with sequential title. The dashboard
        // is the canonical open-ended-start UI for logged-in users;
        // this branch is the bare "begin" affordance (default slime,
        // default tunnel) for users who skip the dashboard.
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(campaigns)
          .where(eq(campaigns.userId, userId));
        const id = uuidv7();
        await db.insert(campaigns).values({
          id,
          userId,
          title: `Run #${(count ?? 0) + 1}`,
          formId,
          locationId,
        });
        campaignId = id;
      }
    } else {
      // Anon path — open-ended start lives here.
      reincarnatedAs = body.reincarnatedAs?.trim() || null;
      formId = body.formId ?? pickFormId(reincarnatedAs);
      if (
        body.locationId &&
        (AVAILABLE_LOCATIONS as readonly string[]).includes(body.locationId)
      ) {
        locationId = body.locationId;
      } else {
        locationId = pickRandomLocation();
      }
    }

    // Phase 5.5 Day 36-37: new logged-in users without
    // tutorial_completed get a tutorial session. Triggered only
    // when the player has no campaignId and no campaigns yet.
    let isTutorial = false;
    if (userId && !campaignId) {
      try {
        const [u] = await db
          .select({ done: users.tutorialCompleted })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (u && !u.done) isTutorial = true;
      } catch {
        /* ignore */
      }
    }

    const result = await createSession(db, formId, {
      locationId,
      reincarnatedAs,
      isTutorial,
    });
    if (campaignId) {
      await db
        .update(sessions)
        .set({ campaignId })
        .where(eq(sessions.id, result.sessionId));
    }

    const cookiePayload = userId
      ? { userId, sessionId: result.sessionId }
      : { sessionId: result.sessionId };
    const token = await mintCookie(cookiePayload);

    log.info("session.created", {
      sessionId: result.sessionId,
      userId,
      campaignId,
      formId,
      locationId,
      reincarnatedAs,
    });

    const res = NextResponse.json({
      sessionId: result.sessionId,
      formId: result.formId,
      campaignId,
      locationId,
      reincarnatedAs,
    });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: env().NODE_ENV === "production",
      maxAge: SESSION_COOKIE_TTL_DAYS * 24 * 60 * 60,
      path: "/",
    });
    return res;
  } catch (err) {
    log.error("session.create.failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
