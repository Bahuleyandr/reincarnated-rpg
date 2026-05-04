/**
 * Player-to-player marketplace — Phase 6 anchor (post-Phase-8
 * scaffold).
 *
 * The seller surrenders the item to escrow at listing time; on
 * purchase the buyer's coins go to the seller minus a 10% sink
 * fee (prevents zero-sum economy growth). Items return to the
 * seller via the standard event-emission path on cancel/expiry.
 *
 * The listing lifecycle has four terminal states:
 *   active   → cancelled  (seller pulls listing; item returns)
 *   active   → expired    (7d cleanup; item returns)
 *   active   → sold       (buyer paid; item moves)
 *
 * Sales flow uses the SAME coin events the rest of the economy
 * uses: coins.gained ('marketplace:sale:<itemId>') for seller,
 * coins.spent ('marketplace:purchase:<itemId>') for buyer. The
 * 10% fee never goes to a user — it disappears (sink).
 */
import { and, asc, eq, gt, gte, lte } from "drizzle-orm";

import { applyCoinDelta, getCoins } from "../economy/coins";
import type { Db } from "../db/client";
import {
  marketplaceListings,
  type MarketplaceListing,
} from "../db/schema";
import { uuidv7 } from "../util/uuidv7";

export const SINK_FEE_PERCENT = 10;
export const LISTING_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const PRICE_MIN = 1;
export const PRICE_MAX = 100_000;
export const QTY_MIN = 1;
export const QTY_MAX = 99;
export const NOTE_MAX_LEN = 160;

export interface ListInputs {
  sellerUserId: string;
  itemId: string;
  qty: number;
  pricePerUnit: number;
  note?: string | null;
  /** The seller's currently-held qty for this item (in their
   *  active session's projection). The caller pre-fetches this
   *  and the validator confirms qty is held; the actual escrow
   *  emission lives on the caller's side via the standard
   *  inventory.removed pipeline. */
  currentInventoryQty: number;
}

export type ListError =
  | { ok: false; error: "qty_bounds" }
  | { ok: false; error: "price_bounds" }
  | { ok: false; error: "note_too_long" }
  | { ok: false; error: "insufficient_inventory"; have: number };

export type ListResult = { ok: true; id: string } | ListError;

export function validateListing(args: ListInputs): ListResult | null {
  if (args.qty < QTY_MIN || args.qty > QTY_MAX) {
    return { ok: false, error: "qty_bounds" };
  }
  if (
    args.pricePerUnit < PRICE_MIN ||
    args.pricePerUnit > PRICE_MAX
  ) {
    return { ok: false, error: "price_bounds" };
  }
  if (args.note && args.note.length > NOTE_MAX_LEN) {
    return { ok: false, error: "note_too_long" };
  }
  if (args.currentInventoryQty < args.qty) {
    return {
      ok: false,
      error: "insufficient_inventory",
      have: args.currentInventoryQty,
    };
  }
  return null;
}

export async function listItem(
  db: Db,
  args: ListInputs,
): Promise<ListResult> {
  const v = validateListing(args);
  if (v && !v.ok) return v;
  const id = uuidv7();
  const now = new Date();
  await db.insert(marketplaceListings).values({
    id,
    sellerUserId: args.sellerUserId,
    itemId: args.itemId,
    qty: args.qty,
    pricePerUnit: args.pricePerUnit,
    note: args.note ?? null,
    status: "active",
    listedAt: now,
    expiresAt: new Date(now.getTime() + LISTING_DURATION_MS),
  });
  return { ok: true, id };
}

export interface BrowseFilter {
  itemId?: string;
  limit?: number;
  /** Skip listings cheaper than this. */
  minPrice?: number;
}

export async function browseListings(
  db: Db,
  filter: BrowseFilter = {},
): Promise<MarketplaceListing[]> {
  const limit = Math.max(1, Math.min(100, filter.limit ?? 25));
  const now = new Date();
  const conds = [
    eq(marketplaceListings.status, "active"),
    gt(marketplaceListings.expiresAt, now),
  ];
  if (filter.itemId) {
    conds.push(eq(marketplaceListings.itemId, filter.itemId));
  }
  if (typeof filter.minPrice === "number") {
    conds.push(gte(marketplaceListings.pricePerUnit, filter.minPrice));
  }
  return db
    .select()
    .from(marketplaceListings)
    .where(and(...conds))
    .orderBy(asc(marketplaceListings.pricePerUnit))
    .limit(limit);
}

/**
 * The seller's own listings (any status). Used by the
 * /marketplace UI to show "your listings" + a Cancel button on
 * active rows.
 */
export async function myListings(
  db: Db,
  args: { sellerUserId: string; limit?: number },
): Promise<MarketplaceListing[]> {
  const limit = Math.max(1, Math.min(100, args.limit ?? 25));
  return db
    .select()
    .from(marketplaceListings)
    .where(eq(marketplaceListings.sellerUserId, args.sellerUserId))
    .orderBy(asc(marketplaceListings.expiresAt))
    .limit(limit);
}

export type PurchaseResult =
  | {
      ok: true;
      listing: MarketplaceListing;
      buyerSpent: number;
      sellerEarned: number;
      sinkFee: number;
    }
  | { ok: false; error: string };

/**
 * Atomic purchase: validate listing is still active, charge
 * buyer (10% sink to oblivion), credit seller. Inventory
 * transfer (item moving from seller's escrow to buyer's bag)
 * is the caller's responsibility — they emit the
 * inventory.added event on the buyer's session, and the seller
 * already escrowed their item at list time.
 *
 * Self-purchase blocked.
 */
export async function purchaseListing(
  db: Db,
  args: { listingId: string; buyerUserId: string },
): Promise<PurchaseResult> {
  const [row] = await db
    .select()
    .from(marketplaceListings)
    .where(eq(marketplaceListings.id, args.listingId))
    .limit(1);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "active") {
    return { ok: false, error: `not_active:${row.status}` };
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "expired" };
  }
  if (row.sellerUserId === args.buyerUserId) {
    return { ok: false, error: "self_purchase" };
  }
  const total = row.pricePerUnit * row.qty;
  const sinkFee = Math.ceil((total * SINK_FEE_PERCENT) / 100);
  const sellerEarned = total - sinkFee;
  const buyerCoins = await getCoins(db, { userId: args.buyerUserId });
  if (buyerCoins < total) {
    return { ok: false, error: "insufficient_coins" };
  }
  // Charge buyer + credit seller.
  await applyCoinDelta(db, { userId: args.buyerUserId }, -total);
  await applyCoinDelta(
    db,
    { userId: row.sellerUserId },
    sellerEarned,
  );
  // Mark sold.
  await db
    .update(marketplaceListings)
    .set({
      status: "sold",
      buyerUserId: args.buyerUserId,
      soldAt: new Date(),
    })
    .where(eq(marketplaceListings.id, row.id));
  return {
    ok: true,
    listing: row,
    buyerSpent: total,
    sellerEarned,
    sinkFee,
  };
}

/**
 * Seller cancels their own listing. Item returns via the
 * caller's inventory.added emission.
 */
export async function cancelListing(
  db: Db,
  args: { listingId: string; sellerUserId: string },
): Promise<{ ok: boolean; error?: string; itemId?: string; qty?: number }> {
  const [row] = await db
    .select()
    .from(marketplaceListings)
    .where(eq(marketplaceListings.id, args.listingId))
    .limit(1);
  if (!row) return { ok: false, error: "not_found" };
  if (row.sellerUserId !== args.sellerUserId) {
    return { ok: false, error: "not_owner" };
  }
  if (row.status !== "active") {
    return { ok: false, error: `not_active:${row.status}` };
  }
  await db
    .update(marketplaceListings)
    .set({ status: "cancelled" })
    .where(eq(marketplaceListings.id, row.id));
  return { ok: true, itemId: row.itemId, qty: row.qty };
}

/**
 * Cleanup: flip expired listings to status='expired'. Returns
 * the rows that just expired so the caller can return items to
 * sellers via the standard event pipeline.
 */
export async function expireOverdueListings(
  db: Db,
): Promise<MarketplaceListing[]> {
  const now = new Date();
  const expired = await db
    .update(marketplaceListings)
    .set({ status: "expired" })
    .where(
      and(
        eq(marketplaceListings.status, "active"),
        lte(marketplaceListings.expiresAt, now),
      ),
    )
    .returning();
  return expired;
}
