/**
 * Lore store — the read/write layer for the global world_lore ledger.
 *
 * Writes:
 *   promoteToLore(db, judgment, source) — inserts a row when the
 *   judge said salience ≥ 0.6.
 *   adminWriteLore(db, ...) — admin-direct injection (no judge).
 *   adminEditLore(db, id, patch, editor) — edit an existing entry.
 *   adminRedactLore(db, id) — soft-delete (set expiresAt=NOW).
 *
 * Reads:
 *   recentLore(db, limit) — most recent + salient lore for the
 *   public /meta feed. Applies salience-time decay so old high-
 *   salience entries don't crowd out recent ones.
 *   recallLore(db, queryText, k) — top-k lore by similarity (or
 *   decayed salience+recency fallback) for narrator injection.
 *
 * Lore is GLOBAL — not user-scoped. Every player's narrator on
 * turn 1 of a fresh campaign sees the same top-k entries. This is
 * the central knowledge base.
 *
 * Salience decay model:
 *   effective_salience = salience * exp(-age_days / halflife_days)
 *
 *   With halflife=30, a fresh 0.85-salience entry stays at ~0.85
 *   for the first day, decays to ~0.42 at 30 days, ~0.21 at 60
 *   days. The expiresAt cutoff still applies on top.
 */
import {
  and,
  desc,
  eq,
  gt,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import type { Db } from "../db/client";
import { worldLore, type WorldLore } from "../db/schema";
import { embedText } from "../memory/episodic";
import { invalidatePrefix } from "../util/cache";
import { log } from "../util/log";
import { uuidv7 } from "../util/uuidv7";

import type { JudgmentResult } from "./judge";

/** Half-life of lore salience, in days. After this many days an
 *  entry's effective salience halves. Tunable. */
export const LORE_HALFLIFE_DAYS = 30;

/** Cap entries with effective_salience below this from public read.
 *  Keeps the chronicle from filling up with stale entries indefinitely.
 *  Admin redaction (set expiresAt=NOW) is a separate, sharper tool. */
export const LORE_MIN_EFFECTIVE_SALIENCE = 0.05;

/** SQL expression for effective salience. Reused across reads so the
 *  ranking is consistent. Postgres EXTRACT(EPOCH FROM age) gives
 *  seconds; convert to days then halflife exponent. */
function effectiveSalienceSql() {
  return sql<number>`(${worldLore.salience} * EXP(-((EXTRACT(EPOCH FROM (NOW() - ${worldLore.createdAt})) / 86400.0) / ${LORE_HALFLIFE_DAYS})))`;
}

interface PromoteSource {
  userId?: string | null;
  campaignId?: string | null;
  sessionId?: string | null;
  formId?: string | null;
  locationId?: string | null;
  phase?: string | null;
}

export async function promoteToLore(
  db: Db,
  judgment: JudgmentResult,
  source: PromoteSource,
): Promise<WorldLore | null> {
  if (!judgment.salient) return null;
  let embedding: number[] | null = null;
  try {
    embedding = await embedText(judgment.summary, "document");
  } catch (err) {
    log.warn("lore.embed_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  const id = uuidv7();
  const now = new Date();
  await db.insert(worldLore).values({
    id,
    summary: judgment.summary,
    prose: judgment.prose,
    embedding: embedding ?? undefined,
    salience: judgment.salience,
    category: judgment.category,
    tags: judgment.tags,
    sourceUserId: source.userId ?? null,
    sourceCampaignId: source.campaignId ?? null,
    sourceSessionId: source.sessionId ?? null,
    sourceLocationId: source.locationId ?? null,
    sourceFormId: source.formId ?? null,
    sourcePhase: source.phase ?? null,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
  });
  log.info("lore.promoted", {
    id,
    salience: judgment.salience,
    category: judgment.category,
    summary: judgment.summary,
  });
  invalidatePrefix("lore:");
  const rows = await db
    .select()
    .from(worldLore)
    .where(eq(worldLore.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Admin direct write — bypasses the judge. Use for canonical
 *  events the operator wants on the chronicle (festivals,
 *  declarations, world-shaping admin actions). */
export async function adminWriteLore(
  db: Db,
  args: {
    summary: string;
    prose?: string | null;
    salience?: number;
    category?: string | null;
    tags?: string[];
    expiresAt?: Date | null;
    adminUserId: string;
  },
): Promise<WorldLore> {
  let embedding: number[] | null = null;
  try {
    embedding = await embedText(args.summary, "document");
  } catch (err) {
    log.warn("lore.admin_embed_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  const id = uuidv7();
  const now = new Date();
  const salience = Math.max(
    0,
    Math.min(1, args.salience ?? 0.85),
  );
  await db.insert(worldLore).values({
    id,
    summary: args.summary,
    prose: args.prose ?? null,
    embedding: embedding ?? undefined,
    salience,
    category: args.category ?? "other",
    tags: args.tags ?? [],
    sourceUserId: args.adminUserId,
    sourceCampaignId: null,
    sourceSessionId: null,
    sourceLocationId: null,
    sourceFormId: null,
    sourcePhase: null,
    createdAt: now,
    updatedAt: now,
    lastEditedByUserId: args.adminUserId,
    expiresAt: args.expiresAt ?? null,
  });
  log.info("lore.admin_write", {
    id,
    adminUserId: args.adminUserId,
    salience,
    summary: args.summary,
  });
  invalidatePrefix("lore:");
  const rows = await db
    .select()
    .from(worldLore)
    .where(eq(worldLore.id, id))
    .limit(1);
  return rows[0]!;
}

/** Admin edit. Updates summary/prose/category/tags/salience/expiresAt
 *  and bumps updatedAt + lastEditedByUserId. Re-embeds when summary
 *  changes. */
export async function adminEditLore(
  db: Db,
  id: string,
  patch: {
    summary?: string;
    prose?: string | null;
    salience?: number;
    category?: string | null;
    tags?: string[];
    expiresAt?: Date | null;
  },
  adminUserId: string,
): Promise<WorldLore | null> {
  const set: Record<string, unknown> = {
    updatedAt: new Date(),
    lastEditedByUserId: adminUserId,
  };
  if (patch.summary !== undefined) {
    set.summary = patch.summary;
    try {
      const emb = await embedText(patch.summary, "document");
      if (emb) set.embedding = emb;
    } catch (err) {
      log.warn("lore.admin_edit_embed_failed", {
        id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (patch.prose !== undefined) set.prose = patch.prose;
  if (patch.salience !== undefined)
    set.salience = Math.max(0, Math.min(1, patch.salience));
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.tags !== undefined) set.tags = patch.tags;
  if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt;
  await db.update(worldLore).set(set).where(eq(worldLore.id, id));
  log.info("lore.admin_edit", { id, adminUserId, fields: Object.keys(patch) });
  invalidatePrefix("lore:");
  const rows = await db
    .select()
    .from(worldLore)
    .where(eq(worldLore.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Admin redact — set expiresAt to NOW so the entry falls out of all
 *  recall paths immediately. The row is preserved for audit; admin
 *  /god page lists redacted entries when explicitly asked. */
export async function adminRedactLore(
  db: Db,
  id: string,
  adminUserId: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(worldLore)
    .set({
      expiresAt: now,
      updatedAt: now,
      lastEditedByUserId: adminUserId,
    })
    .where(eq(worldLore.id, id));
  log.info("lore.admin_redact", { id, adminUserId });
  invalidatePrefix("lore:");
}

/** Recent + salient lore for the public /meta feed and the
 *  narrator's first-turn recall. Applies salience-time decay so
 *  fresh entries surface naturally; filters expired + below-floor
 *  entries. */
export async function recentLore(
  db: Db,
  limit = 12,
  opts: { includeRedacted?: boolean } = {},
): Promise<WorldLore[]> {
  const now = new Date();
  const eff = effectiveSalienceSql();
  const expiryClause = opts.includeRedacted
    ? sql`true`
    : or(isNull(worldLore.expiresAt), gt(worldLore.expiresAt, now))!;
  return db
    .select()
    .from(worldLore)
    .where(
      and(
        expiryClause,
        opts.includeRedacted
          ? sql`true`
          : sql`(${eff}) >= ${LORE_MIN_EFFECTIVE_SALIENCE}`,
      ),
    )
    .orderBy(desc(eff), desc(worldLore.createdAt))
    .limit(limit);
}

/**
 * Semantic recall — top-k lore similar to the queryText. Falls
 * back to decayed salience-recency when no embedding is computable.
 */
export async function recallLore(
  db: Db,
  queryText: string,
  k = 4,
): Promise<WorldLore[]> {
  const now = new Date();
  const eff = effectiveSalienceSql();
  if (queryText.trim()) {
    let qEmbedding: number[] | null = null;
    try {
      qEmbedding = await embedText(queryText, "query");
    } catch {
      qEmbedding = null;
    }
    if (qEmbedding) {
      const lit = `[${qEmbedding.join(",")}]`;
      return db
        .select()
        .from(worldLore)
        .where(
          and(
            or(isNull(worldLore.expiresAt), gt(worldLore.expiresAt, now)),
            sql`(${eff}) >= ${LORE_MIN_EFFECTIVE_SALIENCE}`,
          ),
        )
        .orderBy(sql`${worldLore.embedding} <=> ${lit}::vector`)
        .limit(k);
    }
  }
  return recentLore(db, k);
}

/** Admin-only listing — returns all entries including redacted, for
 *  the /god lore-admin section. Sorted by createdAt DESC. */
export async function listLoreForAdmin(
  db: Db,
  limit = 50,
): Promise<WorldLore[]> {
  return db
    .select()
    .from(worldLore)
    .orderBy(desc(worldLore.createdAt))
    .limit(limit);
}

/** Suppress unused — kept for potential admin filters. */
void lt;
