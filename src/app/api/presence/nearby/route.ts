/**
 * GET /api/presence/nearby — players (PCs) currently in the SAME
 * room as the requesting session. Excludes the requester themselves.
 *
 * Uses the session's own projection to determine room — no query
 * params needed; the cookie identifies the session, the projection
 * tells us where they are.
 *
 * Returns:
 *   { room: { locationId, roomId }, nearby: NearbyPlayer[] }
 *
 * The list is small (typically < 20) so we don't paginate.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { projections } from "@/lib/db/schema";
import { resolveSessionContext } from "@/lib/game/campaign-context";
import { nearbyInRoom } from "@/lib/game/presence";
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
  const sessionId = verified.sessionId;

  const ctx = await resolveSessionContext(db, sessionId);

  // Read the projection's roomId. Cheaper than re-running loadProjection.
  const [snap] = await db
    .select({ state: projections.state })
    .from(projections)
    .where(eq(projections.sessionId, sessionId))
    .limit(1);
  const state = snap?.state as
    | {
        location?: { id?: string; roomId?: string };
      }
    | undefined;
  const locationId = state?.location?.id ?? ctx.locationId;
  const roomId = state?.location?.roomId;

  if (!roomId) {
    // No projection yet — player hasn't taken their first turn.
    return NextResponse.json({
      room: { locationId, roomId: null },
      nearby: [],
    });
  }

  const nearby = await nearbyInRoom(db, locationId, roomId, sessionId);
  return NextResponse.json({
    room: { locationId, roomId },
    nearby,
  });
}
