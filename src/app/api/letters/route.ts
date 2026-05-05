/**
 * GET  /api/letters?folder=inbox|sent — list letters.
 * POST /api/letters — send a letter. Body:
 *   { toUsername?, toNpcTemplateId?, subject, body, replyToId?, voiceMode? }
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { listInbox, listSent, sendLetter, unreadCount } from "@/lib/letters/mail";
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
  const folder = url.searchParams.get("folder") ?? "inbox";
  if (folder === "sent") {
    const sent = await listSent(db, { userId: verified.userId });
    return NextResponse.json({ folder: "sent", letters: sent });
  }
  const inbox = await listInbox(db, { userId: verified.userId });
  const unread = await unreadCount(db, verified.userId);
  return NextResponse.json({ folder: "inbox", letters: inbox, unread });
}

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  let body: {
    toUsername?: unknown;
    toNpcTemplateId?: unknown;
    subject?: unknown;
    body?: unknown;
    replyToId?: unknown;
    voiceMode?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof body.subject !== "string" || typeof body.body !== "string") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const r = await sendLetter(db, {
    fromUserId: verified.userId,
    toUsername:
      typeof body.toUsername === "string" ? body.toUsername : undefined,
    toNpcTemplateId:
      typeof body.toNpcTemplateId === "string"
        ? body.toNpcTemplateId
        : undefined,
    subject: body.subject,
    body: body.body,
    replyToId:
      typeof body.replyToId === "string" ? body.replyToId : null,
    voiceMode:
      typeof body.voiceMode === "string" ? body.voiceMode : undefined,
  });
  if (!r.ok) {
    return NextResponse.json(r, { status: 400 });
  }
  return NextResponse.json(r);
}
