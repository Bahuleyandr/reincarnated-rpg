/**
 * Turn orchestrator — wires the per-turn pipeline:
 *
 *   sanitize → classify → roll → load projection → narrate →
 *   validate tools (atomic) → append narration → match beats →
 *   write snapshot → return narration + final projection.
 *
 * Errors at any step are logged and surfaced to the caller; the
 * append-only invariant means partial state can never leak — only
 * the events that successfully landed are visible on next read.
 *
 * The session's source-of-truth seed lives on the first
 * `session.started` event; we cache it per-process with a small map.
 */
import { badLuckRollPenalty, BAD_LUCK_MAX, type ModerationOutcome } from "../moderation";
import { log } from "../util/log";
import { deriveSeed } from "../util/rng";
import { type Narrator } from "../narrator";

import { createMemory, retrieveMemories } from "../memory/episodic";
import { persistRunToWorld, recallWorld, shouldRecallWorld } from "../memory/world";

import { matchBeats, type BeatPack } from "./beats";
import { classifyHaiku } from "./classify-haiku";
import { appendEvents, readLog, rowToEvent } from "./events";
import { applyEvents, loadProjection, writeSnapshot } from "./projection";
import { classify } from "./classify";
import { roll2d6, rollFromDice } from "./rules";
import { sanitizePlayerInput } from "./sanitize";
import { checkTone, checkToneFast } from "./tone";
import { validateToolsToEvents } from "./tools";
import type { Event, FormTemplate, LocationTemplate, Projection } from "./types";
import type { Db } from "../db/client";

export interface RunTurnArgs {
  db: Db;
  sessionId: string;
  input: string;
  form: FormTemplate;
  location: LocationTemplate;
  narrator: Narrator;
  /** Optional safety net used when `narrator.narrate` throws (network
   *  / provider 5xx / auth failure). When set, we route the turn
   *  through this narrator instead of letting the request 500.
   *  Convention: pass a `TemplateNarrator` here so the run never
   *  stalls because the user's BYO LLM is down. */
  fallbackNarrator?: Narrator;
  beatPack?: BeatPack;
  /** Cap turn count; if reached, fire session.ended('cap'). Default 10. */
  turnCap?: number;
  /** Test/eval-only deterministic dice override. Production routes do
   * not expose this; it exists so scenario fixtures can pin a band. */
  rollOverride?: { d1: number; d2: number; mod?: number };
  /** Per-call-type LLM upgrades. When `useLlmClassifier=true`, the
   *  regex `classify()` is replaced by `classifyHaiku()` (which falls
   *  back to regex on low confidence). When `useLlmTone=true`, the
   *  regex `checkToneFast` is wrapped with `checkTone()` second-pass.
   *  Both routes use `provider` + the supplied model. Telemetry rows
   *  carry userId + presetId. */
  llmJudges?: {
    useClassifier: boolean;
    useTone: boolean;
    provider: import("../ai/provider").AIProvider;
    classifierModel?: string;
    toneModel?: string;
    userId?: string | null;
    presetId?: string | null;
  };
  /** World-memory hooks. When set:
   *   - turn 1 of a new campaign pulls world memories + NPCs into
   *     relevantMemories so the narrator can reference past lives;
   *   - on session.ended (death / win / cap) we persist the run's
   *     NPCs + a deterministic summary into the world layer.
   *  Anon sessions skip both (no userId to bind to). */
  world?: {
    userId: string;
    campaignId?: string | null;
    formId?: string;
    locationId?: string;
  };
  /** Streaming hook. When supplied, the FIRST narrator call streams
   *  text deltas through this callback as they arrive. Retries
   *  triggered by tool-validation or tone failure run non-streaming
   *  (the UI replaces the prior text on retry, so streaming the retry
   *  would be confusing). */
  onNarrationStreamDelta?: (delta: string) => void;
  /** Initial form-state buffs from the catalog option's starterBonus.
   *  Only applied when no snapshot exists yet (first turn). On
   *  subsequent turns the bonus is already baked into the snapshot
   *  and this arg is a no-op. */
  starterFormState?: Record<string, number>;
  /** Moderation outcome from the route. When the verdict is "severe",
   *  runTurn short-circuits — no classify/roll/narrate, just a
   *  refusal narration event + bad-luck stack. When "mild", the run
   *  continues normally but bad_luck stacks for the next few turns.
   *  "clean" is the default. "injection" is filtered at the route and
   *  never reaches runTurn. */
  moderation?: ModerationOutcome;
}

export interface TurnResult {
  ok: true;
  narration: string;
  projection: Projection;
  toolEvents: number;
  beatsFired: string[];
  /** True when the configured narrator threw and we used
   *  fallbackNarrator. The API surfaces this so the UI can show a
   *  "your LLM is having trouble" banner. */
  narratorFallback?: boolean;
  /** Error surfaced from the failing primary narrator (only when
   *  narratorFallback=true). Truncated to 200 chars. */
  narratorFallbackReason?: string;
}

export interface TurnError {
  ok: false;
  error: string;
  projection: Projection;
}

export async function runTurn(args: RunTurnArgs): Promise<TurnResult | TurnError> {
  const {
    db,
    sessionId,
    input,
    form,
    location,
    narrator,
    fallbackNarrator,
    beatPack,
    turnCap = 10,
    llmJudges,
    world,
    onNarrationStreamDelta,
    starterFormState,
  } = args;
  const moderation = args.moderation;
  let narratorFallback = false;
  let narratorFallbackReason: string | undefined;

  const t0 = Date.now();
  let projection = await loadProjection(db, sessionId, form, location, {
    starterFormState,
  });
  if (projection.status !== "active") {
    return { ok: false, error: `session is ${projection.status}`, projection };
  }

  const { raw, sanitized } = sanitizePlayerInput(input);
  const turnNumber = projection.turn + 1;
  const turnBegunEvent: Event = {
    kind: "turn.begun",
    turn: turnNumber,
    input: raw,
    inputSanitized: sanitized,
  };
  const pendingEvents: Event[] = [turnBegunEvent];
  let speculativeProjection = applyEvents(projection, pendingEvents);

  let activeBadLuck =
    typeof projection.form.state["bad_luck"] === "number"
      ? (projection.form.state["bad_luck"] as number)
      : 0;
  if (moderation && moderation.badLuck > 0) {
    const headroom = Math.max(0, BAD_LUCK_MAX - activeBadLuck);
    const delta = Math.min(moderation.badLuck, headroom);
    if (delta > 0) {
      pendingEvents.push({
        kind: "form_state.changed",
        field: "bad_luck",
        delta,
      });
      activeBadLuck += delta;
    }
    log.info("turn.moderation.curse", {
      sessionId,
      verdict: moderation.verdict,
      badLuckAdded: delta,
      newBadLuck: activeBadLuck,
    });
  }
  speculativeProjection = applyEvents(projection, pendingEvents);

  if (moderation?.verdict === "severe") {
    const refusalText =
      moderation.playerMessage ?? "the gods recoil from your tongue. ill-luck clings to you.";
    pendingEvents.push({
      kind: "narration.emitted",
      text: refusalText,
      toolCallsApplied: 0,
    });
    await appendEvents(db, sessionId, pendingEvents);
    const refused = await loadProjection(db, sessionId, form, location);
    await writeSnapshot(db, refused);
    return {
      ok: true,
      narration: refusalText,
      projection: refused,
      toolEvents: 0,
      beatsFired: [],
    };
  }

  const intent = llmJudges?.useClassifier
    ? await classifyHaiku(
        sanitized,
        form,
        {
          db,
          sessionId,
          userId: llmJudges.userId ?? null,
          presetId: llmJudges.presetId ?? null,
        },
        {
          provider: llmJudges.provider,
          model: llmJudges.classifierModel,
        },
      )
    : classify(sanitized, form);
  const intentEvent: Event = {
    kind: "intent.classified",
    verb: intent.verb,
    confidence: intent.confidence,
  };
  pendingEvents.push(intentEvent);

  const sessionSeed = await getSessionSeed(db, sessionId);
  const seed = deriveSeed(sessionSeed, turnNumber);
  const rollStat = form.verbMappings?.[intent.verb]?.rollStat ?? null;
  const baseMod = rollStat ? (form.stats[rollStat] ?? 0) : 0;
  const luckPenalty = badLuckRollPenalty(activeBadLuck);
  // Adaptive difficulty (Phase 2 Day 12). Logged-in players on a
  // consecutive death-streak get +1 to subsequent rolls. The
  // mechanic is invisible to the narrator — it just nudges `mod`.
  let adaptiveBonus = 0;
  if (world?.userId) {
    try {
      const { computeAdaptiveDifficulty } = await import(
        "../difficulty/adaptive"
      );
      const { users: usersTbl } = await import("../db/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      const u = (
        await db
          .select({ s: usersTbl.adaptiveDeathStreak })
          .from(usersTbl)
          .where(eqOp(usersTbl.id, world.userId))
          .limit(1)
      )[0];
      // Synthesize the recent-campaigns shape from the streak count.
      // Pure logic in computeAdaptiveDifficulty handles the rest.
      const streak = u?.s ?? 0;
      const synthetic = Array.from({ length: streak }, () => ({
        reason: "death" as const,
        endedAt: new Date(),
      }));
      const result = computeAdaptiveDifficulty(synthetic);
      adaptiveBonus = result.modifier;
    } catch (err) {
      log.warn("turn.adaptive_difficulty.read_failed", {
        sessionId,
        userId: world.userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const mod = baseMod + luckPenalty + adaptiveBonus;
  const roll = args.rollOverride
    ? {
        ...rollFromDice(args.rollOverride.d1, args.rollOverride.d2, args.rollOverride.mod ?? mod),
        seed,
      }
    : roll2d6(seed, mod);
  const rollEvent: Event = {
    kind: "roll.resolved",
    roll,
    against: rollStat ?? "default",
  };
  pendingEvents.push(rollEvent);
  if (luckPenalty < 0) {
    log.info("turn.moderation.luck_penalty", {
      sessionId,
      activeBadLuck,
      baseMod,
      luckPenalty,
      finalMod: mod,
    });
  }
  if (adaptiveBonus > 0) {
    log.info("turn.adaptive_difficulty.bonus", {
      sessionId,
      userId: world?.userId,
      adaptiveBonus,
      finalMod: mod,
    });
  }

  speculativeProjection = applyEvents(projection, pendingEvents);

  const entitySlugs = Object.keys(speculativeProjection.npcs).filter(
    (slug) =>
      sanitized.toLowerCase().includes(slug.replace(/-/g, " ")) ||
      sanitized.toLowerCase().includes(slug),
  );
  let relevantMemories: import("./types").Memory[] = [];
  try {
    relevantMemories = await retrieveMemories(db, sessionId, sanitized, {
      k: 4,
      entitySlugs,
      currentTurn: turnNumber,
    });
  } catch (err) {
    log.warn("turn.memory.retrieve_failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  // World-layer recall: only on the first turn of a new campaign,
  // and only for logged-in users (anon sessions have no world). The
  // world memories ride the same channel — the narrator can't tell
  // them apart at the type level, just by the "world:" prefix on
  // the summary string.
  if (world?.userId && shouldRecallWorld(speculativeProjection)) {
    try {
      const worldMems = await recallWorld(db, world.userId, sanitized, {
        kMemories: 3,
        kNpcs: 4,
      });
      relevantMemories = [...worldMems, ...relevantMemories];
    } catch (err) {
      log.warn("turn.world.recall_failed", {
        userId: world.userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Companion recall (Phase 2 Day 7-8). Up to 2 bonded companions
    // surface as Memory entries on turn 1. The narrator decides
    // whether to weave them in.
    try {
      const { recallCompanions } = await import("../companions/recall");
      const companions = await recallCompanions(db, world.userId, 2);
      if (companions.length > 0) {
        relevantMemories = [...companions, ...relevantMemories];
      }
    } catch (err) {
      log.warn("turn.companions.recall_failed", {
        userId: world.userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Wonder events (Phase 4.5 Day 17). Per-turn 1% chance to inject
  // a single unsolicited "what was that?" flavor line. Appended to
  // relevantMemories as a synthetic high-salience memory so the
  // narrator can weave it in without seeing extra mechanics.
  let firedWonder: { id: string; flavor: string } | null = null;
  try {
    const { pickWonder } = await import("../wonders/select");
    // Compose a stable seed: session seed + turn number gives a
    // deterministic wonder choice for reproducibility.
    const wonderSeed = (sessionSeed ^ (turnNumber * 0x9e3779b1)) >>> 0;
    // Pull the last few turn's wonder events for cooldown.
    const recentWonderIds = pendingEvents
      .filter((e): e is Event & { kind: "wonder.fired" } => e.kind === "wonder.fired")
      .map((e) => e.wonderId);
    const fullEventLog = (await readLog(db, sessionId)).map(rowToEvent);
    const recentFromLog = fullEventLog
      .filter((e): e is Event & { kind: "wonder.fired" } => e.kind === "wonder.fired")
      .slice(-15)
      .map((e) => e.wonderId);
    const wonder = pickWonder({
      seed: wonderSeed,
      formId: form.id,
      locationId: location.id,
      recentWonderIds: [...recentWonderIds, ...recentFromLog],
    });
    if (wonder) {
      firedWonder = { id: wonder.id, flavor: wonder.narrationFlavor };
      pendingEvents.push({
        kind: "wonder.fired",
        wonderId: wonder.id,
        flavor: wonder.narrationFlavor,
      });
      // Inject as a memory so the narrator gets it through the
      // existing prompt path. High salience so it stands out.
      relevantMemories = [
        {
          id: `wonder:${wonder.id}:${turnNumber}`,
          summary: `WONDER (this turn only): ${wonder.narrationFlavor}`,
          salience: 0.95,
          eventSeqRange: [turnNumber, turnNumber + 1],
        },
        ...relevantMemories,
      ];
      log.info("turn.wonder.fired", {
        sessionId,
        turn: turnNumber,
        wonderId: wonder.id,
      });
    }
  } catch (err) {
    log.warn("turn.wonder.failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const baseInput = {
    projection: speculativeProjection,
    lastEvents: [turnBegunEvent, intentEvent, rollEvent],
    playerInputSanitized: sanitized,
    roll,
    intent: intent.verb,
    relevantMemories,
  };
  void firedWonder;

  let activeNarrator = narrator;
  let narrate: import("./types").NarrateOutput;
  try {
    if (onNarrationStreamDelta && narrator.narrateStream) {
      narrate = await narrator.narrateStream(baseInput, onNarrationStreamDelta);
    } else {
      narrate = await narrator.narrate(baseInput);
    }
  } catch (err) {
    if (!fallbackNarrator) throw err;
    narratorFallback = true;
    activeNarrator = fallbackNarrator;
    narratorFallbackReason = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    log.warn("turn.narrator.fallback", {
      sessionId,
      turn: turnNumber,
      err: narratorFallbackReason,
    });
    narrate = await fallbackNarrator.narrate(baseInput);
  }

  // Pre-fetch coin balance once for the validator. Used by
  // `trade_with_npc` to gate buys; cheap one-row read. Phase 5 Day 18-19.
  let currentCoins = 0;
  try {
    const { getCoins } = await import("../economy/coins");
    currentCoins = await getCoins(db, {
      userId: world?.userId,
      sessionId: world?.userId ? undefined : sessionId,
    });
  } catch (err) {
    log.warn("turn.coins.read_failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Pre-fetch known skills + levels for the validator. Phase 5 Day 23-24.
  // Anon sessions don't have skills (they live on user_skills which is
  // user-keyed) — skip the read.
  let knownSkills: Set<string> | undefined;
  let skillLevels: Record<string, number> | undefined;
  if (world?.userId) {
    try {
      const { listUserSkills } = await import("../economy/skills");
      const rows = await listUserSkills(db, world.userId);
      knownSkills = new Set(rows.map((r) => r.skillId));
      skillLevels = Object.fromEntries(rows.map((r) => [r.skillId, r.level]));
    } catch (err) {
      log.warn("turn.skills.read_failed", {
        sessionId,
        userId: world.userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Per-turn seed for server-rolled tool outcomes (gather quantity,
  // future skill checks). Mixed with the resource id inside the
  // gather rng so two gathers in the same turn don't collide.
  const toolTurnSeed = (sessionSeed ^ (turnNumber * 0xb7e15163)) >>> 0;

  let toolResult = validateToolsToEvents({
    projection: speculativeProjection,
    tools: narrate.toolCalls,
    form,
    location,
    intent: intent.verb,
    rollBand: roll.band,
    currentCoins,
    turnSeed: toolTurnSeed,
    knownSkills,
    skillLevels,
  });
  let toolRetried = false;
  let toolFellBack = false;
  let acceptedToolCalls = narrate.toolCalls;
  if (!toolResult.ok) {
    toolRetried = true;
    pendingEvents.push({
      kind: "tool_validation_failed",
      tool: toolResult.failure.tool,
      error: toolResult.failure.error,
    });
    log.info("turn.tools.retry", {
      sessionId,
      turn: turnNumber,
      tool: toolResult.failure.tool,
      reason: toolResult.failure.error,
    });
    const retry = await activeNarrator.narrate({
      ...baseInput,
      previousAttempt: {
        text: narrate.text,
        toolCalls: narrate.toolCalls,
        failureReason: `tool ${toolResult.failure.tool}: ${toolResult.failure.error}`,
        failureKind: "tool_validation",
      },
    });
    narrate = retry;
    acceptedToolCalls = retry.toolCalls;
    toolResult = validateToolsToEvents({
      projection: speculativeProjection,
      tools: retry.toolCalls,
      form,
      location,
      intent: intent.verb,
      rollBand: roll.band,
      currentCoins,
      turnSeed: toolTurnSeed,
      knownSkills,
      skillLevels,
    });
    if (!toolResult.ok) {
      toolFellBack = true;
      acceptedToolCalls = [];
      pendingEvents.push({
        kind: "tool_validation_failed",
        tool: toolResult.failure.tool,
        error: toolResult.failure.error,
      });
      log.warn("turn.tools.fallback_to_narrate_only", {
        sessionId,
        turn: turnNumber,
        tool: toolResult.failure.tool,
      });
    }
  }
  const toolEventBatch = toolResult.ok ? toolResult.events : [];
  const toolEvents = toolEventBatch.length;
  pendingEvents.push(...toolEventBatch);

  let tone = checkToneFast(narrate.text, form);
  if (tone.ok && llmJudges?.useTone) {
    tone = await checkTone(
      narrate.text,
      form,
      {
        db,
        sessionId,
        userId: llmJudges.userId ?? null,
        presetId: llmJudges.presetId ?? null,
      },
      { provider: llmJudges.provider, model: llmJudges.toneModel },
    );
  }
  let toneRetried = false;
  if (!tone.ok) {
    toneRetried = true;
    log.info("turn.tone.retry", {
      sessionId,
      turn: turnNumber,
      violations: tone.violations,
      score: tone.score,
    });
    const retry = await activeNarrator.narrate({
      ...baseInput,
      previousAttempt: {
        text: narrate.text,
        toolCalls: narrate.toolCalls,
        failureReason:
          tone.violations.length > 0
            ? `tone violations: ${tone.violations.join(", ")}`
            : `tone judge: ${tone.reason ?? "off-form"}`,
        failureKind: "tone_drift",
      },
    });
    narrate = { text: retry.text, toolCalls: narrate.toolCalls };
    tone = checkToneFast(retry.text, form);
    if (!tone.ok) {
      log.warn("turn.tone.violation_persists", {
        sessionId,
        turn: turnNumber,
        violations: tone.violations,
      });
    }
  }

  pendingEvents.push({
    kind: "narration.emitted",
    text: narrate.text,
    toolCallsApplied: toolEvents,
  });

  const beatsFired: string[] = [];
  if (beatPack) {
    const fired = await loadFiredBeats(db, sessionId, beatPack);
    speculativeProjection = applyEvents(projection, pendingEvents);
    const matches = matchBeats(speculativeProjection, beatPack, fired);
    for (const beat of matches) {
      pendingEvents.push(...beat.fires);
      beatsFired.push(beat.id);
    }
  }

  speculativeProjection = applyEvents(projection, pendingEvents);
  if (speculativeProjection.status === "active" && turnNumber >= turnCap) {
    pendingEvents.push({ kind: "session.ended", reason: "cap" });
    speculativeProjection = applyEvents(projection, pendingEvents);
  }

  if (activeBadLuck > 0 && speculativeProjection.status === "active") {
    pendingEvents.push({
      kind: "form_state.changed",
      field: "bad_luck",
      delta: -1,
    });
  }

  await appendEvents(db, sessionId, pendingEvents);
  projection = await loadProjection(db, sessionId, form, location);
  await writeSnapshot(db, projection);

  // Craft credit consumption (Phase 5 Day 21). One credit per
  // craft.gathered event (Day 22 will add smelt/smith). When the
  // pool is empty, consumeCraftCredit charges 1 energy and refills.
  // If energy is also out, it throws OutOfEnergyForCraftingError —
  // we log + swallow because the event already landed (replay needs
  // it); the next turn's validator will catch the empty pool.
  try {
    const { consumeCraftCredit } = await import("../economy/credits");
    const ref = {
      userId: world?.userId,
      sessionId: world?.userId ? undefined : sessionId,
    };
    const craftEvents = pendingEvents.filter(
      (e) => e.kind === "craft.gathered" || e.kind === "craft.completed",
    );
    for (let i = 0; i < craftEvents.length; i++) {
      try {
        await consumeCraftCredit(db, ref);
      } catch (err) {
        log.warn("turn.craft_credit.consume_failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    log.warn("turn.craft_credit.import_failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Skill side effects (Phase 5 Day 23-24). Apply skill.learned
  // (insert user_skills row) and craft.completed → awardXp (bumps
  // existing user_skills.xp + recomputes level). Both are best-
  // effort; failures are logged. Anon sessions skip both (skills
  // are user-level only).
  if (world?.userId) {
    try {
      const { learnSkill, awardXp } = await import("../economy/skills");
      const learnEvents = pendingEvents.filter(
        (e): e is Event & { kind: "skill.learned" } =>
          e.kind === "skill.learned",
      );
      for (const e of learnEvents) {
        try {
          await learnSkill(db, world.userId, e.skillId, e.fromNpcId);
          log.info("turn.skill.learned", {
            sessionId,
            userId: world.userId,
            skillId: e.skillId,
          });
        } catch (err) {
          log.warn("turn.skill.learn_failed", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // XP awards. Recipe-driven xp.granted carries reason
      // 'skill:<skillId>'. Walk the events and bump matching skills.
      for (const e of pendingEvents) {
        if (e.kind !== "xp.granted") continue;
        if (!e.reason.startsWith("skill:")) continue;
        const skillId = e.reason.slice("skill:".length);
        try {
          const result = await awardXp(db, world.userId, skillId, e.amount);
          if (result?.leveledUp) {
            log.info("turn.skill.leveled_up", {
              sessionId,
              userId: world.userId,
              skillId,
              previousLevel: result.previousLevel,
              newLevel: result.level,
            });
            // Append a skill.leveled_up event AFTER the fact —
            // the projection no-ops it, but predicates and
            // achievements/ticker can read it on the next turn's
            // event log scan. Best-effort; we don't fail the turn
            // if this append errors.
            try {
              await appendEvents(db, sessionId, [
                {
                  kind: "skill.leveled_up",
                  skillId,
                  newLevel: result.level,
                },
              ]);
            } catch (err) {
              log.warn("turn.skill.leveled_up_append_failed", {
                sessionId,
                err: err instanceof Error ? err.message : String(err),
              });
            }
          }
        } catch (err) {
          log.warn("turn.skill.xp_award_failed", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      log.warn("turn.skills.import_failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Coin balance side effect (Phase 5 Day 18-19). Sum the coin delta
  // from this turn's events and apply it to the persistent purse —
  // users.coins for logged-in players, sessions.coins for anon. The
  // events themselves are the canonical source (replay-from-zero
  // reproduces the same delta); this update is just a cache so the
  // UI / next-turn validator can read O(1) without re-summing.
  try {
    const { applyCoinDelta, netCoinDeltaFromEvents } = await import(
      "../economy/coins"
    );
    const coinDelta = netCoinDeltaFromEvents(pendingEvents);
    if (coinDelta !== 0) {
      await applyCoinDelta(
        db,
        {
          userId: world?.userId,
          sessionId: world?.userId ? undefined : sessionId,
        },
        coinDelta,
      );
      log.info("turn.coins.delta_applied", {
        sessionId,
        userId: world?.userId,
        coinDelta,
      });
    }
  } catch (err) {
    log.warn("turn.coins.apply_failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Objective progress (Phase 1 Day 6). Increment any matching
  // objectives based on the events emitted this turn. Best-effort —
  // never breaks the turn pipeline.
  if (world?.userId) {
    try {
      const { tickObjectives } = await import("../objectives/runner");
      await tickObjectives(db, world.userId, pendingEvents);
    } catch (err) {
      log.warn("objectives.tick_failed", {
        sessionId,
        userId: world.userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const tool of acceptedToolCalls) {
    if (tool.name !== "create_memory") continue;
    try {
      await createMemory(db, {
        sessionId,
        summary: tool.summary,
        eventSeqRange: [turnNumber, turnNumber + 1],
        salience: tool.salience ?? 0.5,
      });
    } catch (err) {
      log.warn("turn.memory.create_failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Foreshadowing memory plants (Phase 4.5 Day 16). Pure rules pick
  // at most one event from this turn's pendingEvents to plant as
  // an echo memory. The echo surfaces only as a vague hint for the
  // first few turns, then becomes a normal retrievable memory once
  // projection.turn crosses surfaceAfterTurn. Best-effort.
  try {
    const { pickEchoPlant } = await import("../memory/echoes");
    const echo = pickEchoPlant(pendingEvents);
    if (echo) {
      const surfaceAt = turnNumber + echo.plan.surfaceInTurns;
      await createMemory(db, {
        sessionId,
        summary: echo.plan.fullSummary,
        eventSeqRange: [turnNumber, turnNumber + 1],
        salience: 0.7,
        surfaceAfterTurn: surfaceAt,
        echoHint: echo.plan.hint,
      });
      log.info("turn.echo.planted", {
        sessionId,
        turn: turnNumber,
        surfaceAt,
        sourceKind: echo.source.kind,
      });
    }
  } catch (err) {
    log.warn("turn.echo.plant_failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  if (world?.userId && projection.status !== "active") {
    try {
      await persistRunToWorld(db, {
        userId: world.userId,
        sessionId,
        campaignId: world.campaignId ?? null,
        formId: world.formId,
        locationId: world.locationId,
      });
    } catch (err) {
      log.warn("turn.world.persist_failed", {
        sessionId,
        userId: world.userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info("turn.complete", {
    sessionId,
    turn: turnNumber,
    verb: intent.verb,
    band: roll.band,
    toolEvents,
    beatsFired: beatsFired.length,
    durationMs: Date.now() - t0,
    toolRetried,
    toolFellBack,
    toneRetried,
    activeBadLuck,
  });

  return {
    ok: true,
    narration: narrate.text,
    projection,
    toolEvents,
    beatsFired,
    ...(narratorFallback ? { narratorFallback: true, narratorFallbackReason } : {}),
  };
}

const sessionSeedCache = new Map<string, number>();

async function getSessionSeed(db: Db, sessionId: string): Promise<number> {
  const cached = sessionSeedCache.get(sessionId);
  if (cached !== undefined) return cached;
  const rows = await readLog(db, sessionId, 0);
  for (const row of rows) {
    const event = rowToEvent(row);
    if (event.kind === "session.started") {
      sessionSeedCache.set(sessionId, event.seed);
      return event.seed;
    }
  }
  // No session.started found — fail loud; orchestrator was called
  // before /api/session created the session.
  throw new Error(`no session.started event for session ${sessionId}`);
}

async function loadFiredBeats(db: Db, sessionId: string, pack: BeatPack): Promise<Set<string>> {
  // Day-6 cheap dedupe: a beat is "fired" if its quest objective(s)
  // already exist in the projection. For oncePerSession beats whose
  // fires don't include a quest objective, we conservatively fire
  // them every match (acceptable for v0.1; tighten Day 11).
  const projection = await loadProjection(
    db,
    sessionId,
    {} as FormTemplate,
    {} as LocationTemplate,
  ).catch(() => null);
  const fired = new Set<string>();
  if (!projection) return fired;
  for (const beat of pack.beats) {
    for (const evt of beat.fires) {
      if (evt.kind === "quest.objectiveUpdated") {
        if (projection.quest.objectives[evt.objective] !== undefined) {
          fired.add(beat.id);
          break;
        }
      }
      if (evt.kind === "npc.introduced") {
        if (projection.npcs[evt.npcId]) {
          fired.add(beat.id);
          break;
        }
      }
    }
  }
  return fired;
}

/** Test-only — clears the per-process session-seed cache. */
export function _resetSessionCacheForTests(): void {
  sessionSeedCache.clear();
}

export type RunTurnEvent = Event;
