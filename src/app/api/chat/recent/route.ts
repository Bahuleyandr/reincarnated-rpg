/**
 * GET /api/chat/recent — recent messages in the requesting session's
 * current room. Used on /play first-load before the SSE stream
 * connects.
 *
 * Returns up to 50 messages from the last hour, oldest first.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { recentMessages } from "@/lib/chat/store";
import { db } from "@/lib/db/client";
import { projections } from "@/lib/db/schema";
import { resolveSessionContext } from "@/lib/game/campaign-context";
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
  const [snap] = await db
    .select({ state: projections.state })
    .from(projections)
    .where(eq(projections.sessionId, sessionId))
    .limit(1);
  const state = snap?.state as
    | { location?: { id?: string; roomId?: string } }
    | undefined;
  const roomId = state?.location?.roomId;
  const locationId = state?.location?.id ?? ctx.locationId;
  if (!roomId) {
    return NextResponse.json({
      room: { locationId, roomId: null },
      messages: [],
    });
  }
  const messages = await recentMessages(db, locationId, roomId, 50);
  return NextResponse.json({
    room: { locationId, roomId },
    messages: messages.map((m) => ({
      id: m.id,
      text: m.text,
      displayName: m.displayName,
      username: m.username,
      formId: m.formId,
      createdAt: m.createdAt,
      isSelf: m.sessionId === sessionId,
    })),
  });
}
