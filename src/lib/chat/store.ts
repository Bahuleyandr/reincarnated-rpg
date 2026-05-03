/**
 * Chat store — read/write helpers for room_messages.
 *
 * v1 design notes:
 *   - 280-char per message. Text is sanitised with sanitizePlayerInput
 *     before insertion to neutralise prompt-injection-shaped strings;
 *     it's still cosmetic only here (chat doesn't reach the narrator).
 *   - 1-hour read window: recentMessages filters
 *     `created_at > now() - 1h`. Older rows persist (audit) but
 *     don't surface in the chat UI.
 *   - Rate limit lives in lib/util/rate-limit.ts as an in-process
 *     counter; the say endpoint enforces 10 msg/min/session.
 *   - Display name + username + formId are SNAPSHOTTED at send-time
 *     so a player who later changes their reincarnatedAs doesn't
 *     rewrite their chat history.
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { roomMessages, type RoomMessage } from "../db/schema";
import { sanitizePlayerInput } from "../game/sanitize";
import { uuidv7 } from "../util/uuidv7";

export const CHAT_MAX_LENGTH = 280;
export const CHAT_READ_WINDOW_MINUTES = 60;

export interface PostMessageInput {
  locationId: string;
  roomId: string;
  sessionId: string;
  userId: string | null;
  text: string;
  displayName: string;
  username: string | null;
  formId: string;
}

/** Returns the inserted row. Throws on validation failure. Callers
 *  pre-validate length + auth; this is the last-mile insertion. */
export async function postMessage(
  db: Db,
  input: PostMessageInput,
): Promise<RoomMessage> {
  const sanitized = sanitizePlayerInput(input.text).sanitized.slice(
    0,
    CHAT_MAX_LENGTH,
  );
  if (!sanitized.trim()) {
    throw new Error("empty message");
  }
  const id = uuidv7();
  const now = new Date();
  await db.insert(roomMessages).values({
    id,
    locationId: input.locationId,
    roomId: input.roomId,
    sessionId: input.sessionId,
    userId: input.userId,
    text: sanitized,
    displayName: input.displayName,
    username: input.username,
    formId: input.formId,
    createdAt: now,
  });
  const rows = await db
    .select()
    .from(roomMessages)
    .where(eq(roomMessages.id, id))
    .limit(1);
  return rows[0]!;
}

/**
 * Last-N messages for a room within the read window. Returned in
 * chronological order (oldest first) so the UI can append.
 */
export async function recentMessages(
  db: Db,
  locationId: string,
  roomId: string,
  limit = 50,
): Promise<RoomMessage[]> {
  const cutoff = new Date(
    Date.now() - CHAT_READ_WINDOW_MINUTES * 60 * 1000,
  );
  const rows = await db
    .select()
    .from(roomMessages)
    .where(
      and(
        eq(roomMessages.locationId, locationId),
        eq(roomMessages.roomId, roomId),
        gt(roomMessages.createdAt, cutoff),
      ),
    )
    .orderBy(desc(roomMessages.createdAt))
    .limit(limit);
  return rows.reverse();
}

/**
 * Messages strictly after `since` for a room. Used by the SSE
 * stream loop to send only new messages on each tick.
 */
export async function messagesSince(
  db: Db,
  locationId: string,
  roomId: string,
  since: Date,
): Promise<RoomMessage[]> {
  const cutoff = new Date(
    Date.now() - CHAT_READ_WINDOW_MINUTES * 60 * 1000,
  );
  const effectiveSince = since.getTime() > cutoff.getTime() ? since : cutoff;
  const rows = await db
    .select()
    .from(roomMessages)
    .where(
      and(
        eq(roomMessages.locationId, locationId),
        eq(roomMessages.roomId, roomId),
        gt(roomMessages.createdAt, effectiveSince),
      ),
    )
    .orderBy(roomMessages.createdAt);
  return rows;
}

/** Test/admin helper: how many messages have been posted in the
 *  last `minutes` minutes globally. Useful for abuse monitoring. */
export async function recentMessageCount(
  db: Db,
  minutes: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(roomMessages)
    .where(gt(roomMessages.createdAt, cutoff));
  return r?.n ?? 0;
}
