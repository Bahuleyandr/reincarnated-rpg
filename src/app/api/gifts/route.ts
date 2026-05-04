/**
 * GET /api/gifts — receiver's inbox (unredeemed first, then redeemed).
 * POST /api/gifts — send a gift.
 */
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { gifts, users } from "@/lib/db/schema";
import { sendGift, type GiftKind, MAX_MESSAGE_LEN } from "@/lib/gifts/send";
import { SESSION_COOKIE_NAME, verifyCookie } from "@/lib/session/cookie";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = verified.userId;

  const rows = await db
    .select({
      id: gifts.id,
      fromUserId: gifts.fromUserId,
      kind: gifts.kind,
      payload: gifts.payload,
      message: gifts.message,
      sentAt: gifts.sentAt,
      redeemedAt: gifts.redeemedAt,
    })
    .from(gifts)
    .where(eq(gifts.toUserId, userId))
    .orderBy(desc(gifts.sentAt))
    .limit(50);

  // Resolve sender usernames (one query — keeps the inbox API
  // self-contained even at small scale).
  const senderIds = Array.from(new Set(rows.map((r) => r.fromUserId)));
  const senderRows = senderIds.length
    ? await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.id, senderIds[0])) // single lookup batched at v1 scale
    : [];
  const senderById = new Map<string, string>();
  for (const s of senderRows) senderById.set(s.id, s.username);

  return NextResponse.json({
    inbox: rows.map((r) => ({
      id: r.id,
      from: senderById.get(r.fromUserId) ?? "unknown",
      kind: r.kind,
      payload: r.payload,
      message: r.message,
      sentAtMs: r.sentAt.getTime(),
      redeemedAtMs: r.redeemedAt?.getTime() ?? null,
    })),
    unread: rows.filter((r) => r.redeemedAt === null).length,
  });
}

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: {
    toUsername?: string;
    kind?: string;
    payload?: Record<string, unknown>;
    message?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body.toUsername || typeof body.toUsername !== "string") {
    return NextResponse.json({ error: "missing toUsername" }, { status: 400 });
  }
  if (!body.kind) {
    return NextResponse.json({ error: "missing kind" }, { status: 400 });
  }
  if (body.message && body.message.length > MAX_MESSAGE_LEN) {
    return NextResponse.json({ error: "message too long" }, { status: 400 });
  }

  const result = await sendGift(db, {
    fromUserId: verified.userId,
    toUsername: body.toUsername,
    kind: body.kind as GiftKind,
    payload: body.payload ?? {},
    message: body.message ?? null,
  });

  if (!result.ok) {
    const status =
      result.reason === "user_not_found"
        ? 404
        : result.reason === "rate_limited"
          ? 429
          : result.reason === "self_gift"
            ? 400
            : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ giftId: result.giftId, toUserId: result.toUserId });
}
