/**
 * Stripe payment integration — Phase 8 Day 69-71.
 *
 * Stub-first: when STRIPE_SECRET_KEY is unset, the helpers return
 * 'not_configured' so the rest of the app can ship without
 * billing connected. Once the key is set + the stripe SDK is
 * installed (`npm i stripe`), these functions go live without
 * code changes elsewhere.
 *
 * Tier mapping:
 *   STRIPE_PRICE_SUPPORTER → users.tier = 'supporter'
 *   STRIPE_PRICE_PATRON    → users.tier = 'patron'
 */
import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { stripeEvents, users } from "../db/schema";
import { log } from "../util/log";

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function createCheckoutSession(args: {
  userId: string;
  email: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutResult> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "not_configured" };
  try {
    // Lazy + opaque import — TS shouldn't try to resolve stripe
    // at compile time. Install `stripe` + STRIPE_SECRET_KEY=... to
    // activate.
    const dynImport = new Function("p", "return import(p)") as (
      p: string,
    ) => Promise<unknown>;
    const stripeMod = (await dynImport("stripe")) as {
      default: new (k: string, opts?: Record<string, unknown>) => {
        checkout: {
          sessions: {
            create(args: Record<string, unknown>): Promise<{ url: string | null }>;
          };
        };
      };
    };
    const Stripe = stripeMod.default;
    const stripe = new Stripe(key);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: args.email,
      line_items: [{ price: args.priceId, quantity: 1 }],
      client_reference_id: args.userId,
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
    });
    if (!session.url) return { ok: false, error: "no_url_returned" };
    return { ok: true, url: session.url };
  } catch (err) {
    log.warn("stripe.checkout_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "checkout_threw" };
  }
}

interface StripeEventLike {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Idempotent webhook handler. Inserts the event row on first
 * sight (PRIMARY KEY conflict on retry → no-op), then applies
 * the side effects.
 */
export async function applyStripeEvent(
  db: Db,
  event: StripeEventLike,
): Promise<{ applied: boolean }> {
  // Dedup via PK insert.
  const inserted = await db
    .insert(stripeEvents)
    .values({
      id: event.id,
      eventType: event.type,
      payload: event as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: stripeEvents.id })
    .returning({ id: stripeEvents.id });
  if (inserted.length === 0) {
    return { applied: false };
  }

  const obj = event.data.object as {
    customer?: string;
    client_reference_id?: string;
    status?: string;
    current_period_end?: number;
    items?: { data: Array<{ price: { id: string } }> };
  };
  const userId = obj.client_reference_id;

  // Tier mapping from price id.
  function tierFromPrice(priceId: string | undefined): string | null {
    if (priceId === process.env.STRIPE_PRICE_PATRON) return "patron";
    if (priceId === process.env.STRIPE_PRICE_SUPPORTER) return "supporter";
    return null;
  }

  if (event.type === "checkout.session.completed" && userId) {
    const customerId = obj.customer ?? null;
    if (customerId) {
      await db
        .update(users)
        .set({
          stripeCustomerId: customerId,
          subscriptionStatus: "active",
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    }
  }
  if (
    (event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated") &&
    userId
  ) {
    const status = obj.status ?? null;
    const periodEndUnix = obj.current_period_end ?? null;
    const priceId = obj.items?.data?.[0]?.price?.id;
    const tier = tierFromPrice(priceId);
    await db
      .update(users)
      .set({
        subscriptionStatus: status,
        subscriptionCurrentPeriodEnd: periodEndUnix
          ? new Date(periodEndUnix * 1000)
          : null,
        ...(tier ? { tier } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }
  if (event.type === "customer.subscription.deleted" && userId) {
    await db
      .update(users)
      .set({
        subscriptionStatus: "canceled",
        tier: "free",
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  await db
    .update(stripeEvents)
    .set({ processedAt: new Date() })
    .where(eq(stripeEvents.id, event.id));

  return { applied: true };
}
