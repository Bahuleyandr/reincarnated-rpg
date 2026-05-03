/**
 * Lore store — the read/write layer for the global world_lore ledger.
 *
 * Writes:
 *   promoteToLore(db, judgment, source) — inserts a row when the
 *   judge said salience ≥ 0.6.
 *
 * Reads:
 *   recentLore(db, limit) — most recent + salient lore for the
 *   public /meta feed.
 *   recallLore(db, queryText, k) — top-k lore by similarity (or
 *   salience+recency fallback) for narrator injection.
 *
 * Lore is GLOBAL — not user-scoped. Every player's narrator on
 * turn 1 of a fresh campaign sees the same top-k entries. This is
 * the central knowledge base.
 */
import { and, desc, gt, isNull, or, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { worldLore, type WorldLore } from "../db/schema";
import { embedText } from "../memory/episodic";
import { log } from "../util/log";
import { uuidv7 } from "../util/uuidv7";

import type { JudgmentResult } from "./judge";

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
    expiresAt: null,
  });
  log.info("lore.promoted", {
    id,
    salience: judgment.salience,
    category: judgment.category,
    summary: judgment.summary,
  });
  const rows = await db
    .select()
    .from(worldLore)
    .where(sql`${worldLore.id} = ${id}::uuid`)
    .limit(1);
  return rows[0] ?? null;
}

/** Recent + salient lore for the public /meta feed and the
 *  narrator's first-turn recall. Filters out expired events. */
export async function recentLore(
  db: Db,
  limit = 12,
): Promise<WorldLore[]> {
  const now = new Date();
  return db
    .select()
    .from(worldLore)
    .where(
      or(isNull(worldLore.expiresAt), gt(worldLore.expiresAt, now)),
    )
    .orderBy(desc(worldLore.salience), desc(worldLore.createdAt))
    .limit(limit);
}

/**
 * Semantic recall — top-k lore similar to the queryText. Falls
 * back to salience+recency when no embedding is computable.
 */
export async function recallLore(
  db: Db,
  queryText: string,
  k = 4,
): Promise<WorldLore[]> {
  const now = new Date();
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
          ),
        )
        .orderBy(sql`${worldLore.embedding} <=> ${lit}::vector`)
        .limit(k);
    }
  }
  return recentLore(db, k);
}
