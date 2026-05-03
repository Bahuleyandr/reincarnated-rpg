/**
 * POST /api/session — create a new game session.
 *
 * Anon (no userId in cookie):
 *   - Body ignored. Creates an anon session with cookie {sessionId}.
 *
 * Logged-in (userId in cookie):
 *   - Body { campaignId? } — if present, the session is attached to
 *     that existing campaign (validated against ownership).
 *   - If absent, a new campaign is auto-created with title
 *     "Run #<n>" where n = (current campaign count + 1) for the user.
 *   - Cookie is reissued with {userId, sessionId} so the play page
 *     can read state, AND the user stays signed in.
 */
import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { campaigns, sessions } from "@/lib/db/schema";
import { createSession } from "@/lib/game/session";
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
  try {
    const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const verified = cookie ? await verifyCookie(cookie) : null;
    const userId = verified?.userId ?? null;

    let body: { campaignId?: string } = {};
    try {
      body = (await req.json()) as { campaignId?: string };
    } catch {
      // tolerate empty / non-JSON bodies (the Begin button sends none)
    }

    let campaignId: string | null = null;
    let formId = "lesser-slime";

    if (userId) {
      if (body.campaignId) {
        // Validate ownership.
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
      } else {
        // Auto-create a campaign with sequential title.
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
          locationId: "collapsed-tunnel",
        });
        campaignId = id;
      }
    }

    const result = await createSession(db, formId);
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
    });

    const res = NextResponse.json({
      sessionId: result.sessionId,
      formId: result.formId,
      campaignId,
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
