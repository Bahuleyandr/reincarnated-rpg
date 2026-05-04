/**
 * POST /api/marketplace/[id]/buy — purchase a listing.
 * POST /api/marketplace/[id]/cancel — cancel own listing.
 *
 * Phase 6 anchor.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  cancelListing,
  purchaseListing,
} from "@/lib/marketplace/listings";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }

  if (action === "buy") {
    const r = await purchaseListing(db, {
      listingId: id,
      buyerUserId: verified.userId,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "cancel") {
    const r = await cancelListing(db, {
      listingId: id,
      sellerUserId: verified.userId,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
