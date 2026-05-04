/**
 * Player-to-player gift send. Validates:
 *   - Recipient exists by username (case-sensitive lookup).
 *   - Sender hasn't already sent a gift today (UTC-day window).
 *   - Self-gifting is rejected.
 *   - Message ≤ 280 chars.
 *   - Kind is in the allowed set.
 *
 * Returns either { ok: true, giftId } or { ok: false, reason }.
 * Best-effort: caller handles HTTP status mapping.
 */
import { and, eq, gte, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { gifts, users } from "../db/schema";
import { uuidv7 } from "../util/uuidv7";

export type GiftKind = "energy" | "cleanse" | "blessing";

export interface SendGiftInput {
  fromUserId: string;
  toUsername: string;
  kind: GiftKind;
  payload: Record<string, unknown>;
  message?: string | null;
}

export type SendResult =
  | { ok: true; giftId: string; toUserId: string }
  | {
      ok: false;
      reason:
        | "self_gift"
        | "user_not_found"
        | "rate_limited"
        | "message_too_long"
        | "invalid_kind";
    };

const ALLOWED_KINDS: ReadonlySet<GiftKind> = new Set([
  "energy",
  "cleanse",
  "blessing",
]);
export const MAX_MESSAGE_LEN = 280;

export async function sendGift(
  db: Db,
  input: SendGiftInput,
  now: Date = new Date(),
): Promise<SendResult> {
  if (!ALLOWED_KINDS.has(input.kind)) {
    return { ok: false, reason: "invalid_kind" };
  }
  if (input.message && input.message.length > MAX_MESSAGE_LEN) {
    return { ok: false, reason: "message_too_long" };
  }

  const recipients = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.username, input.toUsername))
    .limit(1);
  const recipient = recipients[0];
  if (!recipient) return { ok: false, reason: "user_not_found" };
  if (recipient.id === input.fromUserId) {
    return { ok: false, reason: "self_gift" };
  }

  // Rate-limit: 1 outgoing gift per UTC day.
  const startOfDayUtc = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
    ),
  );
  const existing = await db
    .select({ id: gifts.id })
    .from(gifts)
    .where(
      and(
        eq(gifts.fromUserId, input.fromUserId),
        gte(gifts.sentAt, startOfDayUtc),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return { ok: false, reason: "rate_limited" };
  }

  const giftId = uuidv7();
  await db.insert(gifts).values({
    id: giftId,
    fromUserId: input.fromUserId,
    toUserId: recipient.id,
    kind: input.kind,
    payload: input.payload as never,
    message: input.message ?? null,
  });

  void sql; // keep import alive for future query needs
  return { ok: true, giftId, toUserId: recipient.id };
}
