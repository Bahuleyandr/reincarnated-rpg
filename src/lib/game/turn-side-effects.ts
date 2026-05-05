/**
 * Post-event side-effects for runTurn (T6.5 extraction).
 *
 * These hooks run AFTER appendEvents lands the event batch but
 * BEFORE the snapshot is written. They project event data into
 * side-effect tables (dialogue_turns, marketplace_listings,
 * daily_runs) — replay-from-zero is preserved because the events
 * are canonical.
 *
 * Each hook is independently best-effort: a failure logs a warning
 * but does not break the turn pipeline.
 *
 * Hooks currently extracted:
 *   - persistDialogueExchanges (was inline in turn.ts ~line 1085)
 *   - persistMarketplaceListings (was ~line 1138)
 *   - updateDailyRunProgress (was ~line 1178)
 *
 * Not yet extracted (still inline in turn.ts because they need
 * runtime context that isn't trivially passed):
 *   - anti-farm counter bumps
 *   - objective ticks
 *   - in-run companion level-up on win
 */
import type { Db } from "../db/client";
import { log } from "../util/log";

import type { Event, Projection } from "./types";

export interface PostEventHookContext {
  db: Db;
  sessionId: string;
  pendingEvents: Event[];
  projection: Projection;
  world: { userId: string } | null;
  turnNumber: number;
}

export async function persistDialogueExchanges(
  ctx: PostEventHookContext,
): Promise<void> {
  try {
    const { appendExchange, fillReply } = await import("../dialogue/thread");
    const dialogueEvents = ctx.pendingEvents.filter(
      (e): e is Event & { kind: "dialogue.exchanged" } =>
        e.kind === "dialogue.exchanged",
    );
    if (dialogueEvents.length === 0) return;
    const narrationEvent = ctx.pendingEvents.find(
      (e): e is Event & { kind: "narration.emitted" } =>
        e.kind === "narration.emitted",
    );
    const narrationText = narrationEvent?.text ?? "";
    for (const e of dialogueEvents) {
      const npcEntry = ctx.projection.npcs[e.npcId] as
        | (Record<string, unknown> & { templateId?: unknown })
        | undefined;
      const templateId =
        npcEntry && typeof npcEntry.templateId === "string"
          ? npcEntry.templateId
          : e.npcId.replace(/-[0-9a-f]{8}$/, "");
      const inserted = await appendExchange(ctx.db, {
        sessionId: ctx.sessionId,
        npcId: e.npcId,
        npcTemplateId: templateId,
        utterance: e.utterance,
        turn: ctx.turnNumber,
      });
      if (inserted && narrationText) {
        const quoteMatch = narrationText.match(
          /[“"][^”"]{1,200}[”"]/,
        );
        const reply = quoteMatch
          ? quoteMatch[0].slice(1, -1)
          : narrationText.slice(0, 200);
        await fillReply(ctx.db, inserted.id, reply);
      }
    }
  } catch (err) {
    log.warn("turn.dialogue.persist_failed", {
      sessionId: ctx.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function persistMarketplaceListings(
  ctx: PostEventHookContext,
): Promise<void> {
  try {
    const listEvents = ctx.pendingEvents.filter(
      (e): e is Event & { kind: "marketplace.listed" } =>
        e.kind === "marketplace.listed",
    );
    if (listEvents.length === 0 || !ctx.world?.userId) return;
    const { listItem } = await import("../marketplace/listings");
    for (const e of listEvents) {
      const r = await listItem(ctx.db, {
        sellerUserId: ctx.world.userId,
        itemId: e.itemId,
        qty: e.qty,
        pricePerUnit: e.pricePerUnit,
        note: e.note,
        currentInventoryQty: e.qty,
        // Phase 9 T3.4: tag the listing with the seller's current
        // location so the regional marketplace tab can filter.
        locationId: ctx.projection.location.id,
      });
      if (!r.ok) {
        log.warn("turn.marketplace.list_failed", {
          sessionId: ctx.sessionId,
          itemId: e.itemId,
          error: r.error,
        });
      }
    }
  } catch (err) {
    log.warn("turn.marketplace.persist_failed", {
      sessionId: ctx.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function updateDailyRunProgress(
  ctx: PostEventHookContext,
): Promise<void> {
  if (!ctx.world?.userId) return;
  try {
    const { findDailyForSession, updateDailyProgress } = await import(
      "../daily/challenge"
    );
    const daily = await findDailyForSession(ctx.db, ctx.sessionId);
    if (!daily) return;
    const status = ctx.projection.status as
      | "active"
      | "won"
      | "dead"
      | "capped";
    await updateDailyProgress(ctx.db, {
      userId: daily.userId,
      utcDate: daily.utcDate,
      status,
      turnCount: ctx.projection.turn,
    });
  } catch (err) {
    log.warn("turn.daily.progress_failed", {
      sessionId: ctx.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Phase 9 T5.1 follow-up — co-play turn rotation. If the session
 * is bound to an active party, advance currentTurnUserId to the
 * next member. On session.ended, transition the party to ended.
 */
export async function rotatePartyTurn(
  ctx: PostEventHookContext,
): Promise<void> {
  try {
    const { getPartyForSession, advanceTurn, endParty } = await import(
      "../parties/coordination"
    );
    const party = await getPartyForSession(ctx.db, ctx.sessionId);
    if (!party || party.status !== "active") return;
    const sessionEnded = ctx.pendingEvents.some(
      (e) => e.kind === "session.ended",
    );
    if (sessionEnded) {
      await endParty(ctx.db, party.id);
      return;
    }
    await advanceTurn(ctx.db, party.id);
  } catch (err) {
    log.warn("turn.party.rotate_failed", {
      sessionId: ctx.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Run all post-event hooks in sequence. Each hook is independently
 * best-effort — a failure in one does not skip the others.
 */
export async function runPostEventHooks(
  ctx: PostEventHookContext,
): Promise<void> {
  await persistDialogueExchanges(ctx);
  await persistMarketplaceListings(ctx);
  await updateDailyRunProgress(ctx);
  await rotatePartyTurn(ctx);
}
