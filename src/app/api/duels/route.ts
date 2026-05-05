/**
 * GET  /api/duels?folder=incoming|outgoing
 * POST /api/duels — { action, ... }
 *
 * Body:
 *   { action: "challenge", targetUsername, contextFaction?, contextVenue?, contextQuote? }
 *   { action: "respond", duelId, decision: "accept"|"refuse" }
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  challengeUser,
  listIncoming,
  listOutgoing,
  respondToDuel,
} from "@/lib/duels/lobby";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  const url = new URL(req.url);
  const folder = url.searchParams.get("folder") ?? "incoming";
  if (folder === "outgoing") {
    return NextResponse.json({
      folder,
      duels: await listOutgoing(db, verified.userId),
    });
  }
  return NextResponse.json({
    folder,
    duels: await listIncoming(db, verified.userId),
  });
}

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  let body: {
    action?: unknown;
    targetUsername?: unknown;
    targetNpcTemplateId?: unknown;
    contextFaction?: unknown;
    contextVenue?: unknown;
    contextQuote?: unknown;
    duelId?: unknown;
    decision?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (body.action === "challenge") {
    const r = await challengeUser(db, {
      challengerUserId: verified.userId,
      targetUsername:
        typeof body.targetUsername === "string"
          ? body.targetUsername
          : undefined,
      targetNpcTemplateId:
        typeof body.targetNpcTemplateId === "string"
          ? body.targetNpcTemplateId
          : undefined,
      contextFaction:
        typeof body.contextFaction === "string"
          ? body.contextFaction
          : null,
      contextVenue:
        typeof body.contextVenue === "string" ? body.contextVenue : null,
      contextQuote:
        typeof body.contextQuote === "string" ? body.contextQuote : null,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (body.action === "respond") {
    if (
      typeof body.duelId !== "string" ||
      (body.decision !== "accept" && body.decision !== "refuse")
    ) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    const r = await respondToDuel(db, {
      duelId: body.duelId,
      targetUserId: verified.userId,
      decision: body.decision,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
