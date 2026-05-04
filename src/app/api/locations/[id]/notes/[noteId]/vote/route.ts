/**
 * POST /api/locations/[id]/notes/[noteId]/vote — idempotent up-vote.
 * Phase 5.5 Day 32-33.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { voteNote } from "@/lib/locations/notes";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const { noteId } = await params;
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  const r = await voteNote(db, { noteId, userId: verified.userId });
  return NextResponse.json(r);
}
