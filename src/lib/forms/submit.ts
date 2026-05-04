/**
 * Player-authored forms — submit + review pipeline.
 *
 * Submitted specs go into player_forms with status='pending_review'.
 * Admin reviewers approve from /god/forms; on approval the spec
 * is copied into content/forms/<approved_form_id>.json so the
 * form catalog picks it up on next reload. Rejection just records
 * the reviewer notes; the row stays for audit.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { and, asc, eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { playerForms, type PlayerForm } from "../db/schema";
import { uuidv7 } from "../util/uuidv7";

export interface FormSpec {
  vitals: Record<string, { max: number; start: number; death?: number | null }>;
  stats: Record<string, number>;
  verbs: string[];
  negativeVocab?: string[];
  sampleCorpus?: string[];
}

export const NAME_MIN = 3;
export const NAME_MAX = 40;
export const THEME_MAX = 200;
export const VERBS_MIN = 3;
export const VERBS_MAX = 8;

export type SubmitError =
  | "empty_name"
  | "name_length"
  | "empty_theme"
  | "theme_length"
  | "verbs_count"
  | "vitals_required"
  | "stats_required";

export type SubmitResult =
  | { ok: true; id: string }
  | { ok: false; error: SubmitError };

export async function submitForm(
  db: Db,
  args: {
    authorUserId: string;
    name: string;
    theme: string;
    spec: FormSpec;
  },
): Promise<SubmitResult> {
  const name = args.name.trim();
  const theme = args.theme.trim();
  if (name.length === 0) return { ok: false, error: "empty_name" };
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return { ok: false, error: "name_length" };
  }
  if (theme.length === 0) return { ok: false, error: "empty_theme" };
  if (theme.length > THEME_MAX) {
    return { ok: false, error: "theme_length" };
  }
  if (
    !Array.isArray(args.spec.verbs) ||
    args.spec.verbs.length < VERBS_MIN ||
    args.spec.verbs.length > VERBS_MAX
  ) {
    return { ok: false, error: "verbs_count" };
  }
  if (
    !args.spec.vitals ||
    Object.keys(args.spec.vitals).length === 0
  ) {
    return { ok: false, error: "vitals_required" };
  }
  if (
    !args.spec.stats ||
    Object.keys(args.spec.stats).length === 0
  ) {
    return { ok: false, error: "stats_required" };
  }

  const id = uuidv7();
  await db.insert(playerForms).values({
    id,
    authorUserId: args.authorUserId,
    name,
    theme,
    spec: args.spec,
    status: "pending_review",
  });
  return { ok: true, id };
}

export async function listSubmissions(
  db: Db,
  status?: string,
): Promise<PlayerForm[]> {
  if (status) {
    return db
      .select()
      .from(playerForms)
      .where(eq(playerForms.status, status))
      .orderBy(asc(playerForms.submittedAt));
  }
  return db
    .select()
    .from(playerForms)
    .orderBy(asc(playerForms.submittedAt));
}

/**
 * Slug helper — lowercase, kebab-case, ascii-only. Colliding
 * slugs get a `-2`, `-3`, ... suffix.
 */
export async function allocateSlug(
  db: Db,
  base: string,
): Promise<string> {
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "player-form";
  let candidate = cleaned;
  let attempt = 1;
  while (true) {
    const [conflict] = await db
      .select({ id: playerForms.id })
      .from(playerForms)
      .where(eq(playerForms.approvedFormId, candidate))
      .limit(1);
    if (!conflict) return candidate;
    attempt += 1;
    candidate = `${cleaned}-${attempt}`;
  }
}

export interface ApproveResult {
  ok: boolean;
  approvedFormId?: string;
  filePath?: string;
  error?: string;
}

export async function approveSubmission(
  db: Db,
  args: {
    submissionId: string;
    reviewerUserId: string;
    notes?: string;
  },
): Promise<ApproveResult> {
  const [row] = await db
    .select()
    .from(playerForms)
    .where(
      and(
        eq(playerForms.id, args.submissionId),
        eq(playerForms.status, "pending_review"),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "not_pending" };
  const slug = await allocateSlug(db, row.name);
  const formJson = {
    _meta: {
      license: "CC BY-NC 4.0",
      version: 1,
      authoredOn: new Date().toISOString().slice(0, 10),
      notes: `Player-submitted via player_forms.id=${row.id}`,
    },
    id: slug,
    displayName: row.name,
    theme: row.theme,
    ...(row.spec as Record<string, unknown>),
  };
  const path = join(process.cwd(), "content", "forms", `${slug}.json`);
  try {
    writeFileSync(path, JSON.stringify(formJson, null, 2) + "\n", "utf-8");
  } catch (err) {
    return {
      ok: false,
      error: `write_failed:${err instanceof Error ? err.message : "unknown"}`,
    };
  }
  await db
    .update(playerForms)
    .set({
      status: "approved",
      approvedFormId: slug,
      reviewerUserId: args.reviewerUserId,
      reviewerNotes: args.notes ?? null,
      reviewedAt: new Date(),
    })
    .where(eq(playerForms.id, args.submissionId));
  return { ok: true, approvedFormId: slug, filePath: path };
}

export async function rejectSubmission(
  db: Db,
  args: {
    submissionId: string;
    reviewerUserId: string;
    notes: string;
  },
): Promise<{ ok: boolean }> {
  await db
    .update(playerForms)
    .set({
      status: "rejected",
      reviewerUserId: args.reviewerUserId,
      reviewerNotes: args.notes,
      reviewedAt: new Date(),
    })
    .where(eq(playerForms.id, args.submissionId));
  return { ok: true };
}
