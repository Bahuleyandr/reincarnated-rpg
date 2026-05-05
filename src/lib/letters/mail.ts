/**
 * Letters / async mail (T3.3, Phase-9).
 *
 * Players send letters to other players (by username or userId)
 * or to recurring NPC templates. Letters are immutable once sent;
 * status flips through pending → delivered → read (or refused).
 *
 * Anti-abuse: 280 char subject + 4000 char body limits;
 * server-side rate-limit lives in the route, not here.
 */
import { and, desc, eq, isNull, or } from "drizzle-orm";

import type { Db } from "../db/client";
import { letters, users } from "../db/schema";
import { uuidv7 } from "../util/uuidv7";

export const SUBJECT_MAX = 280;
export const BODY_MAX = 4000;

export interface SendLetterArgs {
  fromUserId: string;
  toUserId?: string;
  toUsername?: string;
  toNpcTemplateId?: string;
  subject: string;
  body: string;
  replyToId?: string | null;
  voiceMode?: string;
}

export type SendResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | "subject_required"
        | "body_required"
        | "subject_too_long"
        | "body_too_long"
        | "no_recipient"
        | "recipient_not_found"
        | "self_send";
    };

export async function sendLetter(
  db: Db,
  args: SendLetterArgs,
): Promise<SendResult> {
  const subject = args.subject.trim();
  const body = args.body.trim();
  if (subject.length === 0) return { ok: false, error: "subject_required" };
  if (body.length === 0) return { ok: false, error: "body_required" };
  if (subject.length > SUBJECT_MAX)
    return { ok: false, error: "subject_too_long" };
  if (body.length > BODY_MAX) return { ok: false, error: "body_too_long" };

  // Resolve recipient.
  let toUserId: string | null = null;
  let toNpcTemplateId: string | null = null;
  if (args.toUserId) {
    toUserId = args.toUserId;
  } else if (args.toUsername) {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, args.toUsername))
      .limit(1);
    if (!u) return { ok: false, error: "recipient_not_found" };
    toUserId = u.id;
  } else if (args.toNpcTemplateId) {
    toNpcTemplateId = args.toNpcTemplateId;
  } else {
    return { ok: false, error: "no_recipient" };
  }
  if (toUserId && toUserId === args.fromUserId) {
    return { ok: false, error: "self_send" };
  }

  const id = uuidv7();
  await db.insert(letters).values({
    id,
    fromUserId: args.fromUserId,
    toUserId,
    toNpcTemplateId,
    subject,
    body,
    replyToId: args.replyToId ?? null,
    // Player-to-player: pending → delivered immediately.
    // Player-to-NPC: pending stays pending; the recurring engine
    // will mark it delivered when the NPC next appears.
    status: toUserId ? "delivered" : "pending",
    voiceMode: args.voiceMode ?? "spoken",
  });
  return { ok: true, id };
}

export interface InboxRow {
  id: string;
  /** Null when the sender is an NPC (use fromNpcTemplateId instead). */
  fromUserId: string | null;
  fromUsername: string | null;
  /** Phase 10 P5 — set when an NPC sent the letter (e.g. on first
   *  meet during a run). The UI reads it to render the NPC's name
   *  in the inbox row. */
  fromNpcTemplateId: string | null;
  subject: string;
  bodyPreview: string;
  status: string;
  sentAtMs: number;
  readAtMs: number | null;
  voiceMode: string;
}

export async function listInbox(
  db: Db,
  args: { userId: string; limit?: number },
): Promise<InboxRow[]> {
  const limit = Math.max(1, Math.min(200, args.limit ?? 50));
  const rows = await db
    .select({
      id: letters.id,
      fromUserId: letters.fromUserId,
      fromUsername: users.username,
      fromNpcTemplateId: letters.fromNpcTemplateId,
      subject: letters.subject,
      body: letters.body,
      status: letters.status,
      sentAt: letters.sentAt,
      readAt: letters.readAt,
      voiceMode: letters.voiceMode,
    })
    .from(letters)
    .leftJoin(users, eq(users.id, letters.fromUserId))
    .where(eq(letters.toUserId, args.userId))
    .orderBy(desc(letters.sentAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    fromUserId: r.fromUserId,
    fromUsername: r.fromUsername,
    fromNpcTemplateId: r.fromNpcTemplateId,
    subject: r.subject,
    bodyPreview:
      r.body.length > 200 ? r.body.slice(0, 200) + "…" : r.body,
    status: r.status,
    sentAtMs: r.sentAt.getTime(),
    readAtMs: r.readAt?.getTime() ?? null,
    voiceMode: r.voiceMode,
  }));
}

export async function listSent(
  db: Db,
  args: { userId: string; limit?: number },
): Promise<InboxRow[]> {
  const limit = Math.max(1, Math.min(200, args.limit ?? 50));
  const rows = await db
    .select({
      id: letters.id,
      fromUserId: letters.fromUserId,
      subject: letters.subject,
      body: letters.body,
      status: letters.status,
      sentAt: letters.sentAt,
      readAt: letters.readAt,
      voiceMode: letters.voiceMode,
      toUsername: users.username,
    })
    .from(letters)
    .leftJoin(users, eq(users.id, letters.toUserId))
    .where(eq(letters.fromUserId, args.userId))
    .orderBy(desc(letters.sentAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    fromUserId: r.fromUserId,
    fromUsername: r.toUsername, // misnomer here — meaning the OTHER party
    fromNpcTemplateId: null,
    subject: r.subject,
    bodyPreview:
      r.body.length > 200 ? r.body.slice(0, 200) + "…" : r.body,
    status: r.status,
    sentAtMs: r.sentAt.getTime(),
    readAtMs: r.readAt?.getTime() ?? null,
    voiceMode: r.voiceMode,
  }));
}

export async function readLetter(
  db: Db,
  args: { letterId: string; userId: string },
): Promise<{ ok: boolean; body?: string; subject?: string }> {
  const [row] = await db
    .select()
    .from(letters)
    .where(
      and(eq(letters.id, args.letterId), eq(letters.toUserId, args.userId)),
    )
    .limit(1);
  if (!row) return { ok: false };
  if (row.status === "delivered") {
    await db
      .update(letters)
      .set({ status: "read", readAt: new Date() })
      .where(eq(letters.id, args.letterId));
  }
  return { ok: true, body: row.body, subject: row.subject };
}

export async function unreadCount(
  db: Db,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ id: letters.id })
    .from(letters)
    .where(
      and(eq(letters.toUserId, userId), eq(letters.status, "delivered")),
    );
  return rows.length;
}

void or;
void isNull;
