/**
 * POST /api/gifts/[id]/redeem — claim a gift's effect.
 * Idempotent: a second redemption returns 409 already_redeemed.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { redeemGift } from "@/lib/gifts/redeem";
import { SESSION_COOKIE_NAME, verifyCookie } from "@/lib/session/cookie";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await params;
  const result = await redeemGift(db, verified.userId, id);
  if (!result.ok) {
    const status =
      result.reason === "not_found"
        ? 404
        : result.reason === "unauthorized"
          ? 403
          : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ kind: result.kind, effect: result.effect });
}
