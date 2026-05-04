/**
 * POST /api/billing/webhook — Stripe webhook endpoint.
 *
 * Verifies signature, applies the event idempotently. Returns 200
 * fast even on dedup so Stripe stops retrying. Phase 8 Day 69-71.
 */
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { applyStripeEvent } from "@/lib/payments/stripe";
import { log } from "@/lib/util/log";

export async function POST(req: NextRequest) {
  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !secret) {
    return NextResponse.json(
      { error: "not_configured" },
      { status: 503 },
    );
  }
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  if (!sig) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }
  let event;
  try {
    const dynImport = new Function("p", "return import(p)") as (
      p: string,
    ) => Promise<unknown>;
    const stripeMod = (await dynImport("stripe")) as {
      default: new (k: string) => {
        webhooks: {
          constructEvent(
            payload: string,
            sig: string,
            secret: string,
          ): { id: string; type: string; data: { object: Record<string, unknown> } };
        };
      };
    };
    const Stripe = stripeMod.default;
    const stripe = new Stripe(key);
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    log.warn("stripe.webhook.bad_signature", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }
  try {
    await applyStripeEvent(db, event);
  } catch (err) {
    log.warn("stripe.webhook.apply_failed", {
      eventId: event.id,
      err: err instanceof Error ? err.message : String(err),
    });
    // Still 200 — failure means we've already inserted the row;
    // a retry would be a no-op, so log + ack.
  }
  return NextResponse.json({ ok: true });
}

// Stripe needs the raw body for signature verification — disable
// JSON parsing.
export const runtime = "nodejs";
