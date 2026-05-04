/**
 * Player marketplace — listing + browse + purchase + cancel + expiry.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { applyCoinDelta, getCoins } from "@/lib/economy/coins";
import type { Db } from "@/lib/db/client";
import { marketplaceListings, users } from "@/lib/db/schema";
import {
  browseListings,
  cancelListing,
  expireOverdueListings,
  listItem,
  purchaseListing,
  SINK_FEE_PERCENT,
} from "@/lib/marketplace/listings";
import { utcDateString } from "@/lib/energy/streak";
import { uuidv7 } from "@/lib/util/uuidv7";

let client: postgres.Sql;
let db: Db;
let sellerId: string;
let buyerId: string;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  client = postgres(url, { max: 1, onnotice: () => {} });
  db = drizzle(client) as unknown as Db;
});

afterAll(async () => {
  await client.end();
});

beforeEach(async () => {
  await client.unsafe(
    "TRUNCATE marketplace_listings, sessions, users RESTART IDENTITY CASCADE",
  );
  sellerId = uuidv7();
  buyerId = uuidv7();
  const now = new Date();
  await db.insert(users).values([
    {
      id: sellerId,
      email: `s${sellerId}@x.com`,
      username: `s${sellerId}`,
      passwordHash: "x",
      createdAt: now,
      updatedAt: now,
      streakCount: 1,
      streakLastDayUtc: utcDateString(now),
      coins: 0,
    },
    {
      id: buyerId,
      email: `b${buyerId}@x.com`,
      username: `b${buyerId}`,
      passwordHash: "x",
      createdAt: now,
      updatedAt: now,
      streakCount: 1,
      streakLastDayUtc: utcDateString(now),
      coins: 1000,
    },
  ]);
});

describe("listItem + browseListings", () => {
  test("happy path: list + browse returns it cheapest-first", async () => {
    const a = await listItem(db, {
      sellerUserId: sellerId,
      itemId: "iron-ingot",
      qty: 2,
      pricePerUnit: 30,
      currentInventoryQty: 5,
    });
    expect(a.ok).toBe(true);
    const b = await listItem(db, {
      sellerUserId: sellerId,
      itemId: "iron-ingot",
      qty: 1,
      pricePerUnit: 25,
      currentInventoryQty: 5,
    });
    expect(b.ok).toBe(true);
    const rows = await browseListings(db, { itemId: "iron-ingot" });
    expect(rows[0].pricePerUnit).toBe(25);
    expect(rows[1].pricePerUnit).toBe(30);
  });

  test("rejects insufficient inventory", async () => {
    const r = await listItem(db, {
      sellerUserId: sellerId,
      itemId: "iron-ingot",
      qty: 5,
      pricePerUnit: 10,
      currentInventoryQty: 1,
    });
    expect(r.ok).toBe(false);
  });

  test("filter by minPrice", async () => {
    await listItem(db, {
      sellerUserId: sellerId,
      itemId: "x",
      qty: 1,
      pricePerUnit: 5,
      currentInventoryQty: 5,
    });
    await listItem(db, {
      sellerUserId: sellerId,
      itemId: "x",
      qty: 1,
      pricePerUnit: 50,
      currentInventoryQty: 5,
    });
    const rows = await browseListings(db, { itemId: "x", minPrice: 10 });
    expect(rows.length).toBe(1);
    expect(rows[0].pricePerUnit).toBe(50);
  });
});

describe("purchaseListing", () => {
  test("happy path: buyer pays full + seller earns minus 10% sink", async () => {
    const list = await listItem(db, {
      sellerUserId: sellerId,
      itemId: "iron-ingot",
      qty: 2,
      pricePerUnit: 50,
      currentInventoryQty: 5,
    });
    if (!list.ok) throw new Error("list failed");

    const r = await purchaseListing(db, {
      listingId: list.id,
      buyerUserId: buyerId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const total = 100;
    const sink = Math.ceil((total * SINK_FEE_PERCENT) / 100);
    expect(r.buyerSpent).toBe(total);
    expect(r.sinkFee).toBe(sink);
    expect(r.sellerEarned).toBe(total - sink);

    expect(await getCoins(db, { userId: buyerId })).toBe(1000 - total);
    expect(await getCoins(db, { userId: sellerId })).toBe(total - sink);

    const [updated] = await db
      .select()
      .from(marketplaceListings)
      .where(eq(marketplaceListings.id, list.id));
    expect(updated.status).toBe("sold");
    expect(updated.buyerUserId).toBe(buyerId);
  });

  test("self-purchase rejected", async () => {
    // Seed seller with coins so the only blocker is self-purchase.
    await applyCoinDelta(db, { userId: sellerId }, 500);
    const list = await listItem(db, {
      sellerUserId: sellerId,
      itemId: "x",
      qty: 1,
      pricePerUnit: 10,
      currentInventoryQty: 5,
    });
    if (!list.ok) throw new Error("list failed");
    const r = await purchaseListing(db, {
      listingId: list.id,
      buyerUserId: sellerId,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("self_purchase");
  });

  test("insufficient coins rejected", async () => {
    const list = await listItem(db, {
      sellerUserId: sellerId,
      itemId: "x",
      qty: 1,
      pricePerUnit: 9999,
      currentInventoryQty: 5,
    });
    if (!list.ok) throw new Error("list failed");
    const r = await purchaseListing(db, {
      listingId: list.id,
      buyerUserId: buyerId,
    });
    expect(r.ok).toBe(false);
  });

  test("non-active listing rejected", async () => {
    const list = await listItem(db, {
      sellerUserId: sellerId,
      itemId: "x",
      qty: 1,
      pricePerUnit: 10,
      currentInventoryQty: 5,
    });
    if (!list.ok) throw new Error("list failed");
    await db
      .update(marketplaceListings)
      .set({ status: "cancelled" })
      .where(eq(marketplaceListings.id, list.id));
    const r = await purchaseListing(db, {
      listingId: list.id,
      buyerUserId: buyerId,
    });
    expect(r.ok).toBe(false);
  });
});

describe("cancelListing", () => {
  test("seller can cancel own listing", async () => {
    const list = await listItem(db, {
      sellerUserId: sellerId,
      itemId: "x",
      qty: 1,
      pricePerUnit: 10,
      currentInventoryQty: 5,
    });
    if (!list.ok) throw new Error("list failed");
    const r = await cancelListing(db, {
      listingId: list.id,
      sellerUserId: sellerId,
    });
    expect(r.ok).toBe(true);
    expect(r.itemId).toBe("x");
  });

  test("non-owner cannot cancel", async () => {
    const list = await listItem(db, {
      sellerUserId: sellerId,
      itemId: "x",
      qty: 1,
      pricePerUnit: 10,
      currentInventoryQty: 5,
    });
    if (!list.ok) throw new Error("list failed");
    const r = await cancelListing(db, {
      listingId: list.id,
      sellerUserId: buyerId,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_owner");
  });
});

describe("expireOverdueListings", () => {
  test("flips overdue active listings to expired", async () => {
    const list = await listItem(db, {
      sellerUserId: sellerId,
      itemId: "x",
      qty: 1,
      pricePerUnit: 10,
      currentInventoryQty: 5,
    });
    if (!list.ok) throw new Error("list failed");
    // Backdate expires_at.
    await db
      .update(marketplaceListings)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(marketplaceListings.id, list.id));

    const expired = await expireOverdueListings(db);
    expect(expired.length).toBe(1);
    expect(expired[0].status).toBe("expired");
  });
});
