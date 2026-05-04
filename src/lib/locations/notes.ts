/**
 * Asynchronous location notes — Phase 5.5 Day 32-33.
 *
 * Dark Souls-style: players leave a one-line note pinned to a
 * location; future players passing through see top-voted notes.
 *
 * Constraints:
 *   - 1-160 char text
 *   - max 5 active notes per author
 *   - 30d auto-expiry (column default)
 *   - 3+ distinct flag voters → auto-hide pending admin review
 *   - one vote per (note, voter) — UNIQUE on the votes table
 */
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import {
  locationNoteVotes,
  locationNotes,
  type LocationNote,
} from "../db/schema";
import { uuidv7 } from "../util/uuidv7";

export const NOTE_MAX_LEN = 160;
export const NOTE_MAX_ACTIVE_PER_USER = 5;
export const NOTE_AUTO_HIDE_FLAGS = 3;

export interface PublicNote {
  id: string;
  text: string;
  votes: number;
  authorUserId: string | null;
  formId: string | null;
  createdAtMs: number;
}

export async function leaveNote(
  db: Db,
  args: {
    userId: string;
    locationId: string;
    formId: string | null;
    text: string;
  },
): Promise<{ id: string } | { error: string }> {
  const trimmed = args.text.trim();
  if (trimmed.length === 0) return { error: "empty" };
  if (trimmed.length > NOTE_MAX_LEN) {
    return { error: `too_long_${NOTE_MAX_LEN}` };
  }
  if (/[\x00-\x1f]/.test(trimmed)) return { error: "control_chars" };

  // Active-note count per user.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(locationNotes)
    .where(
      and(
        eq(locationNotes.authorUserId, args.userId),
        eq(locationNotes.flagged, false),
        gt(locationNotes.expiresAt, new Date()),
      ),
    );
  if (n >= NOTE_MAX_ACTIVE_PER_USER) {
    return { error: `cap_${NOTE_MAX_ACTIVE_PER_USER}` };
  }

  const id = uuidv7();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(locationNotes).values({
    id,
    locationId: args.locationId,
    formId: args.formId,
    authorUserId: args.userId,
    text: trimmed,
    votes: 0,
    flagCount: 0,
    flagged: false,
    createdAt: now,
    expiresAt,
  });
  return { id };
}

/**
 * Read top-N un-flagged un-expired notes at a location. Form-
 * filtering: a note with formId='lesser-slime' only surfaces for
 * lesser-slime callers; notes with formId=null show to everyone.
 */
export async function topNotes(
  db: Db,
  locationId: string,
  opts: { formId?: string | null; limit?: number } = {},
): Promise<PublicNote[]> {
  const limit = Math.max(1, Math.min(20, opts.limit ?? 3));
  const conditions = [
    eq(locationNotes.locationId, locationId),
    eq(locationNotes.flagged, false),
    gt(locationNotes.expiresAt, new Date()),
  ];
  if (opts.formId !== undefined && opts.formId !== null) {
    conditions.push(
      sql`(${locationNotes.formId} IS NULL OR ${locationNotes.formId} = ${opts.formId})`,
    );
  }
  const rows = await db
    .select({
      id: locationNotes.id,
      text: locationNotes.text,
      votes: locationNotes.votes,
      authorUserId: locationNotes.authorUserId,
      formId: locationNotes.formId,
      createdAt: locationNotes.createdAt,
    })
    .from(locationNotes)
    .where(and(...conditions))
    .orderBy(desc(locationNotes.votes), desc(locationNotes.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    votes: r.votes,
    authorUserId: r.authorUserId,
    formId: r.formId,
    createdAtMs: r.createdAt.getTime(),
  }));
}

/**
 * Idempotent up-vote. UNIQUE(note_id, voter_user_id) means a second
 * call from the same user is a no-op. Bumps locationNotes.votes
 * atomically only on the FIRST insert.
 */
export async function voteNote(
  db: Db,
  args: { noteId: string; userId: string },
): Promise<{ ok: boolean; alreadyVoted?: boolean }> {
  // Try to insert; ignore conflicts.
  const inserted = await db
    .insert(locationNoteVotes)
    .values({
      noteId: args.noteId,
      voterUserId: args.userId,
      voteKind: "up",
    })
    .onConflictDoNothing({
      target: [
        locationNoteVotes.noteId,
        locationNoteVotes.voterUserId,
      ],
    })
    .returning({ id: locationNoteVotes.noteId });
  if (inserted.length === 0) {
    return { ok: true, alreadyVoted: true };
  }
  // First-time vote — bump the cached counter.
  await db
    .update(locationNotes)
    .set({ votes: sql`${locationNotes.votes} + 1` })
    .where(eq(locationNotes.id, args.noteId));
  return { ok: true };
}

/**
 * Distinct-flagger flag. Reuses the votes table (with vote_kind=
 * 'flag'). When the count crosses NOTE_AUTO_HIDE_FLAGS the note
 * is auto-flagged (hidden from public reads pending admin review).
 */
export async function flagNote(
  db: Db,
  args: { noteId: string; userId: string },
): Promise<{ ok: boolean; flagged: boolean }> {
  const inserted = await db
    .insert(locationNoteVotes)
    .values({
      noteId: args.noteId,
      voterUserId: args.userId,
      voteKind: "flag",
    })
    .onConflictDoUpdate({
      target: [locationNoteVotes.noteId, locationNoteVotes.voterUserId],
      set: { voteKind: "flag" },
    })
    .returning({ id: locationNoteVotes.noteId });
  void inserted;
  // Recount flags.
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(locationNoteVotes)
    .where(
      and(
        eq(locationNoteVotes.noteId, args.noteId),
        eq(locationNoteVotes.voteKind, "flag"),
      ),
    );
  const flagged = (count?.n ?? 0) >= NOTE_AUTO_HIDE_FLAGS;
  await db
    .update(locationNotes)
    .set({ flagCount: count?.n ?? 0, flagged })
    .where(eq(locationNotes.id, args.noteId));
  return { ok: true, flagged };
}

/** Admin: full row by id, even when flagged. */
export async function getNoteForAdmin(
  db: Db,
  id: string,
): Promise<LocationNote | null> {
  const [row] = await db
    .select()
    .from(locationNotes)
    .where(eq(locationNotes.id, id))
    .limit(1);
  return row ?? null;
}

void isNotNull;
