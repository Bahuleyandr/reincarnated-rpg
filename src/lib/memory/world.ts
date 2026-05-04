/**
 * World-layer memory: NPCs and notable run-events that persist across
 * a user's campaigns. The brand promise is "the world remembers what
 * you did" — this module is what makes that true.
 *
 * Two flows:
 *
 *   persistRunToWorld(db, userId, sessionId)
 *     Called once per ended run (death / win / cap). Reads the
 *     session's event log, upserts every introduced NPC into
 *     world_npcs (per-user; cumulative relationship score), and
 *     writes 1+ world_memories rows summarizing the run. The summary
 *     is a deterministic concatenation of last-narration + outcome
 *     tags so we don't need an extra LLM call. Embedding uses the
 *     same Voyage / mockEmbedding fallback as episodic memory.
 *
 *   recallWorld(db, userId, queryText, opts)
 *     Returns top-k Memory[] suitable for splicing into
 *     NarrateInput.relevantMemories on the FIRST turn of a new
 *     campaign. Combines:
 *       - all world_npcs the user has met (sorted by relationship
 *         depth) up to a small cap,
 *       - top-k world_memories by cosine similarity to queryText.
 *
 * The function returns the existing Memory shape so the narrator's
 * prompt assembly path doesn't need to change — world memories ride
 * the same channel as session-local episodic memories, just with a
 * "world." prefix on summary so the model can tell them apart.
 */
import { and, desc, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { sessions, users, worldMemories, worldNpcs } from "../db/schema";
import type { Event, Memory, Projection } from "../game/types";
import { applyImprint, imprintTraitFromDeath } from "../legacy/imprint";
import { embedText } from "./episodic";
import { rowToEvent, readLog } from "../game/events";
import {
  getCurrentArc,
  recordContribution as recordMetaContribution,
} from "../meta/long-wyrm";
import { judgeLore, lorePreFilter } from "../lore/judge";
import { promoteToLore } from "../lore/store";
import { uuidv7 } from "../util/uuidv7";
import { log } from "../util/log";

interface PersistOpts {
  userId: string;
  sessionId: string;
  campaignId?: string | null;
  formId?: string;
  locationId?: string;
}

/** Read every event for the session, find NPC introductions and
 *  relationship updates, return a per-NPC roll-up. */
function rollUpNpcInteractions(events: Event[]) {
  const npcs = new Map<
    string,
    {
      slug: string;
      name: string;
      data: Record<string, unknown>;
      relationshipDelta: number;
      helped: number;
      harmed: number;
      everIntroduced: boolean;
    }
  >();
  for (const e of events) {
    if (e.kind === "npc.introduced") {
      const slug = e.npcId;
      const cur = npcs.get(slug);
      const data = e.data as Record<string, unknown>;
      if (!cur) {
        npcs.set(slug, {
          slug,
          name: (data.name as string) ?? slug,
          data,
          relationshipDelta: (data.relationship as number | undefined) ?? 0,
          helped: 0,
          harmed: 0,
          everIntroduced: true,
        });
      }
    } else if (e.kind === "relationship.updated") {
      const slug = e.npcId;
      const cur = npcs.get(slug);
      if (cur) {
        cur.relationshipDelta += e.delta;
        if (e.delta > 0) cur.helped += 1;
        else if (e.delta < 0) cur.harmed += 1;
      }
    }
  }
  return Array.from(npcs.values());
}

/** Tags a single ended-session into world_memories. Outcome-tagged so
 *  retrieval can filter death runs / win runs separately. */
function tagsForRun(events: Event[]): string[] {
  const tags: string[] = [];
  const lastEnd = [...events].reverse().find((e) => e.kind === "session.ended");
  if (lastEnd && lastEnd.kind === "session.ended") {
    tags.push(`outcome:${lastEnd.reason}`);
  }
  for (const e of events) {
    if (e.kind === "npc.introduced") tags.push(`met:${e.npcId}`);
    if (e.kind === "quest.objectiveUpdated" && e.status === "done")
      tags.push(`completed:${e.objective}`);
  }
  return Array.from(new Set(tags));
}

/** Compose a 1-2 sentence run summary deterministically (no LLM call).
 *  Prefers the LAST narration + outcome flavor. */
function composeRunSummary(
  events: Event[],
  ctx: { formId?: string; locationId?: string },
): string {
  const narrations = events
    .filter((e) => e.kind === "narration.emitted")
    .map((e) => (e as { kind: "narration.emitted"; text: string }).text);
  const last = narrations[narrations.length - 1] ?? "";
  // Trim to first sentence(s), max ~280 chars — enough to be evocative.
  const truncated =
    last.length > 280 ? last.slice(0, 277).trimEnd() + "…" : last;
  const ended = [...events]
    .reverse()
    .find((e) => e.kind === "session.ended") as
    | { kind: "session.ended"; reason: string }
    | undefined;
  const outcome = ended?.reason ?? "ongoing";
  const formPart = ctx.formId ? ` as a ${ctx.formId.replace(/-/g, " ")}` : "";
  const locPart = ctx.locationId
    ? ` in ${ctx.locationId.replace(/-/g, " ")}`
    : "";
  return `One past life ended ${outcome}${formPart}${locPart}. ${truncated}`.trim();
}

/**
 * Idempotent — safe to call more than once for the same session.
 * The world_memories row uses a stable id derived from session uuid +
 * "::run-summary" but we just check by sourceCampaignId before insert.
 */
export async function persistRunToWorld(
  db: Db,
  opts: PersistOpts,
): Promise<{ npcsUpserted: number; memoriesWritten: number } | null> {
  // Don't persist anon sessions (no userId to attach memory to).
  if (!opts.userId) return null;
  try {
    const eventsRows = await readLog(db, opts.sessionId);
    const events = eventsRows.map(rowToEvent);
    if (events.length === 0) return null;

    // Skip if no session.ended event (run still going).
    const ended = events.some((e) => e.kind === "session.ended");
    if (!ended) return null;

    // Skip if we've already persisted for this campaign.
    if (opts.campaignId) {
      const existing = await db
        .select({ id: worldMemories.id })
        .from(worldMemories)
        .where(
          and(
            eq(worldMemories.userId, opts.userId),
            eq(worldMemories.sourceCampaignId, opts.campaignId),
          ),
        )
        .limit(1);
      if (existing.length > 0) return { npcsUpserted: 0, memoriesWritten: 0 };
    }

    // Roll up NPCs.
    const rollups = rollUpNpcInteractions(events);
    let npcsUpserted = 0;
    for (const r of rollups) {
      const existing = await db
        .select()
        .from(worldNpcs)
        .where(
          and(
            eq(worldNpcs.userId, opts.userId),
            eq(worldNpcs.slug, r.slug),
          ),
        )
        .limit(1);
      const now = new Date();
      if (existing.length === 0) {
        await db.insert(worldNpcs).values({
          id: uuidv7(),
          userId: opts.userId,
          slug: r.slug,
          name: r.name,
          relationshipScore: r.relationshipDelta,
          memorySummary: `${r.name}. First met you ${
            r.helped > 0
              ? "helpfully"
              : r.harmed > 0
                ? "hostilely"
                : "in passing"
          }.`,
          lastSeenStatus: "alive",
          timesMet: 1,
          timesHelped: r.helped,
          timesHarmed: r.harmed,
          firstMetCampaignId: opts.campaignId ?? null,
          lastSeenCampaignId: opts.campaignId ?? null,
          data: r.data,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        const cur = existing[0];
        await db
          .update(worldNpcs)
          .set({
            relationshipScore: cur.relationshipScore + r.relationshipDelta,
            timesMet: cur.timesMet + 1,
            timesHelped: cur.timesHelped + r.helped,
            timesHarmed: cur.timesHarmed + r.harmed,
            lastSeenCampaignId: opts.campaignId ?? cur.lastSeenCampaignId,
            updatedAt: now,
          })
          .where(eq(worldNpcs.id, cur.id));
      }
      npcsUpserted += 1;
    }

    // Write the run summary as a world_memory.
    const summary = composeRunSummary(events, {
      formId: opts.formId,
      locationId: opts.locationId,
    });
    const tags = tagsForRun(events);
    let embedding: number[] | null = null;
    try {
      embedding = await embedText(summary, "document");
    } catch (err) {
      log.warn("world.embed_failed", {
        userId: opts.userId,
        sessionId: opts.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    // Outcome:death / outcome:win get a salience bump — those are the
    // moments the next campaign should most strongly remember.
    const salience = tags.includes("outcome:win")
      ? 0.95
      : tags.includes("outcome:death")
        ? 0.9
        : 0.5;
    await db.insert(worldMemories).values({
      id: uuidv7(),
      userId: opts.userId,
      summary,
      embedding: embedding ?? undefined,
      tags,
      salience,
      sourceCampaignId: opts.campaignId ?? null,
      sourceFormId: opts.formId,
      sourceLocationId: opts.locationId,
    });

    log.info("world.persisted", {
      userId: opts.userId,
      sessionId: opts.sessionId,
      campaignId: opts.campaignId,
      npcsUpserted,
      tags,
    });

    // Meta-arc contribution (the Long Wyrm). Best-effort — never
    // throws back into the player's turn.
    try {
      await recordMetaContribution(db, events, {
        userId: opts.userId,
        sessionId: opts.sessionId,
        campaignId: opts.campaignId ?? null,
        formId: opts.formId,
        locationId: opts.locationId,
      });
    } catch (err) {
      log.warn("meta.contribution_failed", {
        userId: opts.userId,
        sessionId: opts.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Lore promotion. Cheap pre-filter rejects most runs without an
    // LLM call. Survivors get a single Haiku-tier judge call; if
    // the judge scores ≥0.6, the run is written into the global
    // world_lore ledger and becomes part of the canonical world.
    try {
      const ended = events.find((e) => e.kind === "session.ended") as
        | { kind: "session.ended"; reason: string }
        | undefined;
      const turnCount = events.filter((e) => e.kind === "turn.begun").length;
      const beatsFired = events.filter(
        (e) =>
          e.kind === "quest.objectiveUpdated" && e.status === "done",
      ).length;
      const npcsIntroduced = Array.from(
        new Set(
          events
            .filter((e) => e.kind === "npc.introduced")
            .map((e) => (e as { kind: "npc.introduced"; npcId: string }).npcId),
        ),
      );
      const questsCompleted = Array.from(
        new Set(
          events
            .filter(
              (e) =>
                e.kind === "quest.objectiveUpdated" && e.status === "done",
            )
            .map(
              (e) =>
                (e as { kind: "quest.objectiveUpdated"; objective: string })
                  .objective,
            ),
        ),
      );
      const passes = lorePreFilter(events, {
        turn: turnCount,
        outcome: ended?.reason ?? null,
        beatsFired,
      });
      if (passes) {
        const arc = await getCurrentArc(db);
        const judgment = await judgeLore(
          events,
          {
            formId: opts.formId ?? "unknown",
            locationId: opts.locationId ?? "unknown",
            reincarnatedAs: null, // could be threaded if needed; kept null for now
            outcome: ended?.reason ?? null,
            turn: turnCount,
            npcsIntroduced,
            questsCompleted,
            wyrmPhase: arc?.phase ?? null,
          },
          {
            telemetry: {
              db,
              sessionId: opts.sessionId,
              userId: opts.userId,
            },
          },
        );
        if (judgment) {
          await promoteToLore(db, judgment, {
            userId: opts.userId,
            campaignId: opts.campaignId ?? null,
            sessionId: opts.sessionId,
            formId: opts.formId,
            locationId: opts.locationId,
            phase: arc?.phase ?? null,
          });
        }
      }
    } catch (err) {
      log.warn("lore.promotion_failed", {
        userId: opts.userId,
        sessionId: opts.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Legacy-trait imprint (Phase 1 Day 3). Pure classification of
    // the death cause + a jsonb_set on users.legacy_traits. Best-
    // effort — never breaks run-end persistence.
    try {
      await imprintLegacyTrait(
        db,
        opts.userId,
        opts.formId ?? "lesser-slime",
        events,
      );
    } catch (err) {
      log.warn("legacy.imprint_failed", {
        userId: opts.userId,
        sessionId: opts.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Achievements pass (Phase 1 Day 4). Both session-scope and
    // lifetime-scope evaluation runs at session end. Best-effort.
    try {
      const { evaluateSessionAchievements, evaluateLifetimeAchievements } =
        await import("../achievements/runner");
      await evaluateSessionAchievements(
        db,
        opts.userId,
        events,
        opts.campaignId ?? null,
      );
      await evaluateLifetimeAchievements(db, opts.userId, opts.campaignId ?? null);
    } catch (err) {
      log.warn("achievements.run_end_failed", {
        userId: opts.userId,
        sessionId: opts.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    return { npcsUpserted, memoriesWritten: 1 };
  } catch (err) {
    log.error("world.persist_failed", {
      userId: opts.userId,
      sessionId: opts.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Pull world memories + NPCs for injection on the FIRST turn of a
 * new campaign. Returns Memory[] in the same shape episodic memories
 * use, so the narrator path doesn't need to branch.
 *
 * `queryText` should be the player's input on turn 1. If empty, we
 * fall back to a generic query and rely on salience ordering.
 */
export async function recallWorld(
  db: Db,
  userId: string,
  queryText: string,
  opts: {
    kMemories?: number;
    kNpcs?: number;
    /** Global lore retrieval count (the canonical world ledger).
     *  Lore is shared across all players; every campaign's first
     *  turn pulls top-K and injects with a "lore:" prefix so the
     *  narrator can quote / reference. */
    kLore?: number;
  } = {},
): Promise<Memory[]> {
  const kMemories = opts.kMemories ?? 4;
  const kNpcs = opts.kNpcs ?? 6;
  const kLore = opts.kLore ?? 3;
  const out: Memory[] = [];

  // 0. Global lore — canonical world events. Same kNN approach as
  // memories below, falls back to salience-recency.
  try {
    const { recallLore } = await import("../lore/store");
    const lore = await recallLore(db, queryText, kLore);
    for (const l of lore) {
      out.push({
        id: l.id,
        summary: `lore: ${l.summary}`,
        salience: l.salience,
        eventSeqRange: [0, 0] as [number, number],
      });
    }
  } catch (err) {
    log.warn("world.recall_lore_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    // NPCs: top by absolute relationship depth (most-engaged first).
    const npcs = await db
      .select()
      .from(worldNpcs)
      .where(eq(worldNpcs.userId, userId))
      .orderBy(desc(worldNpcs.timesMet), desc(worldNpcs.updatedAt))
      .limit(kNpcs);
    for (const n of npcs) {
      const verb =
        n.timesHelped > n.timesHarmed
          ? "saved"
          : n.timesHarmed > n.timesHelped
            ? "wronged"
            : "encountered";
      const summary = `world: ${n.name}. ${n.timesMet} past lives have met them; you ${verb} them ${
        n.timesHelped + n.timesHarmed > 0
          ? `${Math.max(n.timesHelped, n.timesHarmed)} time${Math.max(n.timesHelped, n.timesHarmed) === 1 ? "" : "s"}`
          : "in passing"
      }. ${n.memorySummary ?? ""}`.trim();
      out.push({
        id: n.id,
        summary,
        salience: Math.min(1, 0.5 + Math.abs(n.relationshipScore) * 0.05),
        eventSeqRange: [0, 0] as [number, number],
      });
    }

    // Memories: kNN if we have an embedding for the query, otherwise
    // most-salient. We avoid running embedText if queryText is empty.
    let memoryRows: Array<{
      id: string;
      summary: string;
      salience: number;
      createdAt: Date;
    }> = [];
    if (queryText.trim()) {
      let qEmbedding: number[] | null = null;
      try {
        qEmbedding = await embedText(queryText, "query");
      } catch {
        qEmbedding = null;
      }
      if (qEmbedding) {
        const lit = `[${qEmbedding.join(",")}]`;
        memoryRows = await db
          .select({
            id: worldMemories.id,
            summary: worldMemories.summary,
            salience: worldMemories.salience,
            createdAt: worldMemories.createdAt,
          })
          .from(worldMemories)
          .where(eq(worldMemories.userId, userId))
          .orderBy(
            sql`${worldMemories.embedding} <=> ${lit}::vector`,
          )
          .limit(kMemories);
      }
    }
    if (memoryRows.length === 0) {
      memoryRows = await db
        .select({
          id: worldMemories.id,
          summary: worldMemories.summary,
          salience: worldMemories.salience,
          createdAt: worldMemories.createdAt,
        })
        .from(worldMemories)
        .where(eq(worldMemories.userId, userId))
        .orderBy(desc(worldMemories.salience), desc(worldMemories.createdAt))
        .limit(kMemories);
    }
    for (const m of memoryRows) {
      out.push({
        id: m.id,
        summary: m.summary.startsWith("world:") ? m.summary : `world: ${m.summary}`,
        salience: m.salience,
        eventSeqRange: [0, 0] as [number, number],
      });
    }
  } catch (err) {
    log.warn("world.recall_failed", {
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}

/**
 * Convenience: given a Projection (which knows form/location/turn)
 * decide whether THIS turn should call recallWorld. We only do it on
 * turn 1 of a campaign — subsequent turns let session-local episodic
 * memories take over.
 */
export function shouldRecallWorld(projection: Projection): boolean {
  return projection.turn === 0;
}

/** Suppress lint for sessions import — it isn't used directly here but
 *  the type-side schema reference keeps drizzle's introspection happy. */
void sessions;

/**
 * Legacy-trait imprint helper (Phase 1 Day 3). Pure classification
 * via lib/legacy/imprint then a single atomic UPDATE on
 * users.legacy_traits.
 *
 * Uses jsonb_set with a default empty object so the column is safe
 * even on rows that pre-date the migration. Increment is read-modify-
 * write — acceptable race-window since two concurrent run-ends for
 * the same user is extremely unlikely; worst-case we lose one
 * +1 increment.
 */
async function imprintLegacyTrait(
  db: Db,
  userId: string,
  formId: string,
  events: Event[],
): Promise<void> {
  const ended = events.find(
    (e): e is Event & { kind: "session.ended" } => e.kind === "session.ended",
  );
  if (!ended) return;

  // Read existing traits.
  const rows = await db
    .select({ legacyTraits: users.legacyTraits })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const existing =
    (rows[0]?.legacyTraits as Record<string, number> | undefined) ?? {};

  const result = imprintTraitFromDeath({
    reason: ended.reason,
    formId,
    events,
    existingTraits: existing,
  });
  if (!result.traitId) return;

  const next = applyImprint(existing, result);
  await db.update(users).set({ legacyTraits: next }).where(eq(users.id, userId));

  log.info("legacy.imprint", {
    userId,
    formId,
    reason: ended.reason,
    causeFamily: result.causeFamily,
    traitId: result.traitId,
    newCount: next[result.traitId],
  });
}
