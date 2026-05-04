/**
 * POST /api/billing/checkout — create a Stripe Checkout session.
 * Phase 8 Day 69-71.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createCheckoutSession } from "@/lib/payments/stripe";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";

export async function POST(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "login_required" }, { status: 401 });
  }
  let body: { tier?: unknown };
  try {
    body = (await req.json()) as { tier?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const tier = body.tier;
  if (tier !== "supporter" && tier !== "patron") {
    return NextResponse.json({ error: "invalid_tier" }, { status: 400 });
  }
  const priceId =
    tier === "patron"
      ? process.env.STRIPE_PRICE_PATRON
      : process.env.STRIPE_PRICE_SUPPORTER;
  if (!priceId) {
    return NextResponse.json(
      { error: "tier_not_configured" },
      { status: 503 },
    );
  }

  const [u] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, verified.userId))
    .limit(1);
  if (!u) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }
  const origin = req.nextUrl.origin;
  const r = await createCheckoutSession({
    userId: verified.userId,
    email: u.email,
    priceId,
    successUrl: `${origin}/billing/success`,
    cancelUrl: `${origin}/billing/cancel`,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 503 });
  }
  return NextResponse.json({ url: r.url });
}
