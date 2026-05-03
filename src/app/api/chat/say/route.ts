/**
 * POST /api/chat/say — body { text }
 *
 * Speaks in the requesting session's current room. Resolves the
 * room from the session's projection (the canonical source of
 * "where are you"). Snapshots displayName + username + formId at
 * send-time for history immutability.
 *
 * Rate limit: 10 messages/minute/session. 280-char cap.
 *
 * Errors:
 *   401 — no session cookie
 *   400 — empty / invalid body
 *   404 — session has no projection (player hasn't taken first turn)
 *   413 — message > 280 chars
 *   429 — rate-limited
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import {
  CHAT_MAX_LENGTH,
  postMessage,
} from "@/lib/chat/store";
import { db } from "@/lib/db/client";
import { campaigns, projections, sessions, users } from "@/lib/db/schema";
import { resolveSessionContext } from "@/lib/game/campaign-context";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { checkRate } from "@/lib/util/rate-limit";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "no session" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.sessionId) {
    return NextResponse.json({ error: "no session" }, { status: 401 });
  }
  const sessionId = verified.sessionId;

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }
  if (text.length > CHAT_MAX_LENGTH) {
    return NextResponse.json(
      {
        error: `message too long (${text.length}/${CHAT_MAX_LENGTH})`,
      },
      { status: 413 },
    );
  }

  // Rate limit: 10/minute/session.
  if (!checkRate(`chat:${sessionId}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "you're talking too fast. wait a moment." },
      { status: 429 },
    );
  }

  // Resolve the player's current room from their projection.
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
    return NextResponse.json(
      { error: "you haven't woken into a room yet" },
      { status: 404 },
    );
  }

  // Fetch displayName + username for the snapshot.
  let username: string | null = null;
  let displayName = ctx.reincarnatedAs ?? humanise(ctx.formId);
  if (verified.userId) {
    const u = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, verified.userId))
      .limit(1);
    username = u[0]?.username ?? null;
    // For logged-in players, prefer reincarnatedAs from their
    // campaign (which is what the run is "in character" as).
    if (ctx.reincarnatedAs) displayName = ctx.reincarnatedAs;
  } else {
    // Anon: pull reincarnatedAs from the session row directly.
    const s = await db
      .select({
        reincarnatedAs: sessions.reincarnatedAs,
        formId: sessions.formId,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (s[0]?.reincarnatedAs) displayName = s[0].reincarnatedAs;
    else if (s[0]?.formId) displayName = humanise(s[0].formId);
  }

  const msg = await postMessage(db, {
    locationId,
    roomId,
    sessionId,
    userId: verified.userId ?? null,
    text,
    displayName,
    username,
    formId: ctx.formId,
  });

  return NextResponse.json({
    message: {
      id: msg.id,
      text: msg.text,
      displayName: msg.displayName,
      username: msg.username,
      formId: msg.formId,
      createdAt: msg.createdAt,
    },
  });
}

function humanise(formId: string): string {
  switch (formId) {
    case "lesser-slime":
      return "a lesser slime";
    case "cursed-book":
      return "a cursed book";
    case "dragon-egg":
      return "a dragon egg";
    case "dungeon-core":
      return "a dungeon core";
    case "generic-creature":
    default:
      return "a reincarnated thing";
  }
}

// Suppress unused — kept for future bulk-fetch.
void campaigns;
