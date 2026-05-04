/**
 * Famous deaths — Phase 5.5 Day 28.
 *
 * Pure plumbing: given a memorability verdict + run context, write a
 * `world_lore` row with category='famous_death'. The 24h-public-delay
 * (Phase 4.5 Day 15) carries forward — the entry is invisible on
 * /lore until a day after createdAt.
 *
 * NO LLM: the headline is composed deterministically by
 * `evaluateMemorability`. Cost-discipline policy.
 */
import type { Db } from "../db/client";
import { worldLore } from "../db/schema";
import { embedText } from "../memory/episodic";
import { invalidatePrefix } from "../util/cache";
import { log } from "../util/log";
import { uuidv7 } from "../util/uuidv7";

import type { MemorabilityResult } from "../predicates/memorability";

export interface FamousDeathContext {
  userId: string;
  sessionId: string;
  campaignId?: string | null;
  formId?: string | null;
  locationId?: string | null;
  /** Set when the run was running under a known wyrm phase; pulled
   *  from the meta-arc. The /lore page colors entries by phase. */
  phase?: string | null;
}

export async function writeFamousDeath(
  db: Db,
  memorability: MemorabilityResult,
  ctx: FamousDeathContext,
): Promise<{ loreId: string } | null> {
  if (!memorability.memorable || !memorability.headline) return null;

  let embedding: number[] | null = null;
  try {
    embedding = await embedText(memorability.headline, "document");
  } catch (err) {
    log.warn("lore.famous_death.embed_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const id = uuidv7();
  const now = new Date();
  await db.insert(worldLore).values({
    id,
    summary: memorability.headline,
    prose: null,
    embedding: embedding ?? undefined,
    salience: memorability.salience,
    category: "famous_death",
    tags: ["famous_death", ...memorability.reasons],
    sourceUserId: ctx.userId,
    sourceCampaignId: ctx.campaignId ?? null,
    sourceSessionId: ctx.sessionId,
    sourceLocationId: ctx.locationId ?? null,
    sourceFormId: ctx.formId ?? null,
    sourcePhase: ctx.phase ?? null,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
  });
  invalidatePrefix("lore:");
  log.info("lore.famous_death.written", {
    loreId: id,
    sessionId: ctx.sessionId,
    salience: memorability.salience,
    reasons: memorability.reasons,
  });
  return { loreId: id };
}
