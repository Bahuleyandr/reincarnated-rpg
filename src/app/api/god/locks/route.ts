/**
 * Admin turn-lock controls.
 *
 * GET  /api/god/locks
 *      Returns all currently-held turn-locks.
 *
 * GET  /api/god/locks?sessionId=...
 *      Returns recent audit-log entries for one session.
 *
 * POST /api/god/locks/force-release
 *      Body: { sessionId, reason? }
 *      Force-releases a stuck lock. Logged with the actor's userId.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  forceReleaseTurnLock,
  getActiveLocks,
  getLockHistory,
} from "@/lib/game/turn-lock";
import { requireAdmin } from "@/lib/session/admin";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (sessionId) {
    const history = await getLockHistory(db, sessionId);
    return NextResponse.json({ history });
  }
  const locks = await getActiveLocks(db);
  return NextResponse.json({
    locks: locks.map((l) => ({
      sessionId: l.sessionId,
      token: l.token,
      expiresAtMs: l.expiresAt.getTime(),
      ageMs: l.ageMs,
    })),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(db, req);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: { sessionId?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const sessionId = (body.sessionId ?? "").trim();
  if (!sessionId) {
    return NextResponse.json({ error: "missing sessionId" }, { status: 400 });
  }
  const released = await forceReleaseTurnLock(
    db,
    sessionId,
    admin.userId,
    body.reason ?? null,
  );
  return NextResponse.json({ released });
}
