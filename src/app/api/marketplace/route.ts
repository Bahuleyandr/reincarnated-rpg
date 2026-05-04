/**
 * GET  /api/marketplace — browse active listings.
 * POST /api/marketplace — list an item (seller).
 *
 * Phase 6 anchor.
 *
 * Note: this lightweight endpoint trusts the caller to have
 * already escrowed the item via the standard
 * `remove_inventory` tool. A future revision will enforce
 * escrow inside the route once the projection-context plumbing
 * to do so cleanly is in place.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { browseListings, listItem } from "@/lib/marketplace/listings";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const itemId = url.searchParams.get("itemId") ?? undefined;
  const minPriceRaw = url.searchParams.get("minPrice");
  const minPrice = minPriceRaw ? Number.parseInt(minPriceRaw, 10) : undefined;
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
  const rows = await browseListings(db, { itemId, limit, minPrice });
  return NextResponse.json({
    listings: rows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      qty: r.qty,
      pricePerUnit: r.pricePerUnit,
      note: r.note,
      sellerUserId: r.sellerUserId,
      listedAtMs: r.listedAt.getTime(),
      expiresAtMs: r.expiresAt.getTime(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  let body: {
    itemId?: unknown;
    qty?: unknown;
    pricePerUnit?: unknown;
    note?: unknown;
    currentInventoryQty?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (
    typeof body.itemId !== "string" ||
    typeof body.qty !== "number" ||
    typeof body.pricePerUnit !== "number" ||
    typeof body.currentInventoryQty !== "number"
  ) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note : null;
  const r = await listItem(db, {
    sellerUserId: verified.userId,
    itemId: body.itemId,
    qty: body.qty,
    pricePerUnit: body.pricePerUnit,
    note,
    currentInventoryQty: body.currentInventoryQty,
  });
  if (!r.ok) {
    return NextResponse.json(r, { status: 400 });
  }
  return NextResponse.json(r);
}
