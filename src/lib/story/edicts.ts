/**
 * Edicts — Phase 7 Day 51.
 *
 * The First-to-Sit Hollow Throne quest produces a single proposer
 * per chapter window; their proposed edict (a player note
 * promoted to law) becomes status='active' and rides as a system-
 * prompt fragment for all subsequent narrators while active.
 *
 * Edicts decay via active_until, can be admin-redacted (status=
 * 'redacted'), and never overlap — only one active per chapter.
 */
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { edicts, type Edict } from "../db/schema";
import { uuidv7 } from "../util/uuidv7";

const MAX_LEN = 200;

export async function listActiveEdicts(db: Db): Promise<Edict[]> {
  const now = new Date();
  return db
    .select()
    .from(edicts)
    .where(
      and(
        eq(edicts.status, "active"),
        or(
          isNull(edicts.activeUntil),
          gt(edicts.activeUntil, now),
        ),
      ),
    )
    .orderBy(desc(edicts.activeFrom));
}

export interface ProposeEdictInput {
  chapterId: number;
  proposerUserId: string;
  text: string;
  /** Optional active_until — null means open-ended. */
  activeUntil?: Date | null;
}

export type ProposeEdictResult =
  | { ok: true; id: string }
  | { ok: false; error: "too_long" | "empty" };

export async function proposeEdict(
  db: Db,
  args: ProposeEdictInput,
): Promise<ProposeEdictResult> {
  const trimmed = args.text.trim();
  if (trimmed.length === 0) return { ok: false, error: "empty" };
  if (trimmed.length > MAX_LEN) return { ok: false, error: "too_long" };
  const id = uuidv7();
  await db.insert(edicts).values({
    id,
    chapterId: args.chapterId,
    proposerUserId: args.proposerUserId,
    text: trimmed,
    status: "active",
    activeUntil: args.activeUntil ?? null,
  });
  return { ok: true, id };
}

export async function redactEdict(db: Db, id: string): Promise<void> {
  await db.update(edicts).set({ status: "redacted" }).where(eq(edicts.id, id));
}

/**
 * Compose a single fragment string the narrator carries while
 * any edict is active. Multiple actives are bullet-listed with a
 * shared lead-in.
 */
export async function activeEdictFragment(db: Db): Promise<string | null> {
  const list = await listActiveEdicts(db);
  if (list.length === 0) return null;
  if (list.length === 1) {
    return `EDICT (active law in this world): "${list[0].text}". Reference subtly when natural.`;
  }
  const lines = list.map((e) => `- "${e.text}"`).join("\n");
  return `EDICTS (active laws in this world):\n${lines}\nReference subtly when natural.`;
}

void sql;
