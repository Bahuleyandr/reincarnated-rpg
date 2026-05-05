/**
 * GET /api/letters/[id] — read full letter body. Side-effect: marks
 * the letter `read` if currently `delivered`.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { readLetter } from "@/lib/letters/mail";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  const r = await readLetter(db, { letterId: id, userId: verified.userId });
  if (!r.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    subject: r.subject,
    body: r.body,
  });
}
