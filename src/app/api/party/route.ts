/**
 * GET  /api/party — list open parties.
 * POST /api/party — { action, ... } — create/join/leave/start.
 *
 * Body shapes:
 *   { action: "create", sessionId, maxSize? }
 *   { action: "join", partyId }
 *   { action: "leave", partyId }
 *   { action: "start", partyId }
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  createParty,
  joinParty,
  leaveParty,
  listOpenParties,
  startParty,
} from "@/lib/parties/lobby";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function GET() {
  const list = await listOpenParties(db);
  return NextResponse.json({ parties: list });
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
    sessionId?: unknown;
    partyId?: unknown;
    maxSize?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const action = body.action;
  if (action === "create") {
    if (typeof body.sessionId !== "string") {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    const r = await createParty(db, {
      hostUserId: verified.userId,
      sessionId: body.sessionId,
      maxSize:
        typeof body.maxSize === "number" ? body.maxSize : undefined,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "join") {
    if (typeof body.partyId !== "string") {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    const r = await joinParty(db, {
      partyId: body.partyId,
      userId: verified.userId,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "leave") {
    if (typeof body.partyId !== "string") {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    const r = await leaveParty(db, {
      partyId: body.partyId,
      userId: verified.userId,
    });
    return NextResponse.json(r);
  }
  if (action === "start") {
    if (typeof body.partyId !== "string") {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    const r = await startParty(db, {
      partyId: body.partyId,
      hostUserId: verified.userId,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
