/**
 * Anti-farm caps — Phase 5 Day 26 follow-up.
 *
 * Per-(user, vendor) daily coin-gain cap (`metadata.dailyCoinCap`
 * on each NPC) prevents a single vendor from minting unlimited
 * coins per user per day. Per-(user, resource) daily gather cap
 * (`metadata.dailyGatherCap` on each resource) prevents a player
 * from clear-cutting one resource.
 *
 * Reset is implicit: rows are keyed by date (UTC), so each day
 * starts at 0 without a cron.
 */
import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import {
  resourceDailyGather,
  vendorDailyFlow,
} from "../db/schema";

function todayUtc(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export interface VendorCapCheck {
  /** True when the player is at or above the daily cap for this
   *  vendor — caller should reject the trade. */
  capped: boolean;
  cap: number;
  used: number;
}

/**
 * Read-only check — does NOT mutate. Caller checks first, then
 * calls bumpVendorFlow only on commit. Returns capped=false when
 * dailyCoinCap is unset (no cap configured).
 */
export async function checkVendorCap(
  db: Db,
  args: {
    userId: string;
    vendorTemplateId: string;
    dailyCoinCap?: number;
    /** The amount the player would earn from this trade (positive
     *  for sells, 0 for buys). */
    additionalCoinsEarn: number;
  },
): Promise<VendorCapCheck> {
  if (!args.dailyCoinCap || args.dailyCoinCap <= 0) {
    return { capped: false, cap: 0, used: 0 };
  }
  const [row] = await db
    .select({ used: vendorDailyFlow.totalAmount })
    .from(vendorDailyFlow)
    .where(
      and(
        eq(vendorDailyFlow.userId, args.userId),
        eq(vendorDailyFlow.vendorTemplateId, args.vendorTemplateId),
        eq(vendorDailyFlow.date, todayUtc()),
      ),
    )
    .limit(1);
  const used = row?.used ?? 0;
  const wouldUse = used + Math.max(0, args.additionalCoinsEarn);
  return {
    capped: wouldUse > args.dailyCoinCap,
    cap: args.dailyCoinCap,
    used,
  };
}

/** Bump the vendor flow counter. Called on commit (post-validation). */
export async function bumpVendorFlow(
  db: Db,
  args: {
    userId: string;
    vendorTemplateId: string;
    coinsEarn: number;
  },
): Promise<void> {
  if (args.coinsEarn === 0) return;
  await db
    .insert(vendorDailyFlow)
    .values({
      userId: args.userId,
      vendorTemplateId: args.vendorTemplateId,
      date: todayUtc(),
      totalAmount: args.coinsEarn,
      txnCount: 1,
    })
    .onConflictDoUpdate({
      target: [
        vendorDailyFlow.userId,
        vendorDailyFlow.vendorTemplateId,
        vendorDailyFlow.date,
      ],
      set: {
        totalAmount: sql`${vendorDailyFlow.totalAmount} + ${args.coinsEarn}`,
        txnCount: sql`${vendorDailyFlow.txnCount} + 1`,
      },
    });
}

export interface ResourceCapCheck {
  capped: boolean;
  cap: number;
  used: number;
}

export async function checkResourceCap(
  db: Db,
  args: {
    userId: string;
    resourceId: string;
    dailyGatherCap?: number;
    additionalQty: number;
  },
): Promise<ResourceCapCheck> {
  if (!args.dailyGatherCap || args.dailyGatherCap <= 0) {
    return { capped: false, cap: 0, used: 0 };
  }
  const [row] = await db
    .select({ used: resourceDailyGather.qty })
    .from(resourceDailyGather)
    .where(
      and(
        eq(resourceDailyGather.userId, args.userId),
        eq(resourceDailyGather.resourceId, args.resourceId),
        eq(resourceDailyGather.date, todayUtc()),
      ),
    )
    .limit(1);
  const used = row?.used ?? 0;
  const wouldUse = used + Math.max(0, args.additionalQty);
  return {
    capped: wouldUse > args.dailyGatherCap,
    cap: args.dailyGatherCap,
    used,
  };
}

export async function bumpResourceGather(
  db: Db,
  args: {
    userId: string;
    resourceId: string;
    qty: number;
  },
): Promise<void> {
  if (args.qty <= 0) return;
  await db
    .insert(resourceDailyGather)
    .values({
      userId: args.userId,
      resourceId: args.resourceId,
      date: todayUtc(),
      qty: args.qty,
    })
    .onConflictDoUpdate({
      target: [
        resourceDailyGather.userId,
        resourceDailyGather.resourceId,
        resourceDailyGather.date,
      ],
      set: {
        qty: sql`${resourceDailyGather.qty} + ${args.qty}`,
      },
    });
}
