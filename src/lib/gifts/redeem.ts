/**
 * Atomic gift redemption. Validates ownership + unredeemed state,
 * applies the kind-specific effect, marks redeemed_at. Idempotent
 * via the WHERE clause (a second redemption attempt finds the row
 * already redeemed and returns no_op).
 */
import { and, eq, isNull } from "drizzle-orm";

import type { Db } from "../db/client";
import { gifts, users } from "../db/schema";

export type RedeemResult =
  | { ok: true; kind: string; effect: Record<string, unknown> }
  | { ok: false; reason: "not_found" | "already_redeemed" | "unauthorized" };

export async function redeemGift(
  db: Db,
  toUserId: string,
  giftId: string,
  now: Date = new Date(),
): Promise<RedeemResult> {
  const rows = await db
    .select()
    .from(gifts)
    .where(eq(gifts.id, giftId))
    .limit(1);
  const gift = rows[0];
  if (!gift) return { ok: false, reason: "not_found" };
  if (gift.toUserId !== toUserId) return { ok: false, reason: "unauthorized" };
  if (gift.redeemedAt !== null) return { ok: false, reason: "already_redeemed" };

  // Apply effect inside a transaction so a partial state is impossible.
  const effect: Record<string, unknown> = {};
  await db.transaction(async (tx) => {
    if (gift.kind === "energy") {
      const amount = Number((gift.payload as { amount?: number })?.amount ?? 0);
      if (amount > 0) {
        const cur = (
          await tx
            .select({ e: users.energy })
            .from(users)
            .where(eq(users.id, toUserId))
            .limit(1)
        )[0];
        if (cur) {
          await tx
            .update(users)
            .set({ energy: cur.e + amount, updatedAt: now })
            .where(eq(users.id, toUserId));
          effect.amount = amount;
        }
      }
    }
    // 'cleanse' and 'blessing' are placeholders for v1 — they only
    // record the redemption; the in-fiction "effect" is the message.
    // A future iteration can add bad_luck cleanse + small starter
    // bonus injection here.

    const updated = await tx
      .update(gifts)
      .set({ redeemedAt: now })
      .where(
        and(
          eq(gifts.id, giftId),
          isNull(gifts.redeemedAt),
        ),
      )
      .returning({ id: gifts.id });
    if (updated.length === 0) {
      throw new Error("redeemed_concurrently");
    }
  });

  return { ok: true, kind: gift.kind, effect };
}
