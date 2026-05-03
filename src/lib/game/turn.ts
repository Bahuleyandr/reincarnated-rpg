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
import { eq } from "drizzle-orm";

import { sessions } from "../db/schema";
import { log } from "../util/log";
import { deriveSeed } from "../util/rng";
import { type Narrator } from "../narrator";

import { createMemory, retrieveMemories } from "../memory/episodic";
import { persistRunToWorld, recallWorld, shouldRecallWorld } from "../memory/world";

import { matchBeats, type BeatPack } from "./beats";
import { classifyHaiku } from "./classify-haiku";
import { appendEvents, readLog, rowToEvent } from "./events";
import { loadProjection, writeSnapshot } from "./projection";
import { classify } from "./classify";
import { roll2d6 } from "./rules";
import { sanitizePlayerInput } from "./sanitize";
import { checkTone, checkToneFast } from "./tone";
import { applyTools } from "./tools";
import type {
  Event,
  FormTemplate,
  LocationTemplate,
  Projection,
} from "./types";
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
  } = args;
  let narratorFallback = false;
  let narratorFallbackReason: string | undefined;

  const t0 = Date.now();
  let projection = await loadProjection(db, sessionId, form, location);
  if (projection.status !== "active") {
    return { ok: false, error: `session is ${projection.status}`, projection };
  }

  // 1. Sanitize input.
  const { raw, sanitized } = sanitizePlayerInput(input);

  // 2. turn.begun.
  const turnNumber = projection.turn + 1;
  await appendEvents(db, sessionId, [
    {
      kind: "turn.begun",
      turn: turnNumber,
      input: raw,
      inputSanitized: sanitized,
    },
  ]);

  // 3. Classify intent. Defaults to the free regex; opt-in LLM
  //    classifier replaces it when llmJudges.useClassifier is set.
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
  await appendEvents(db, sessionId, [
    {
      kind: "intent.classified",
      verb: intent.verb,
      confidence: intent.confidence,
    },
  ]);

  // 4. Resolve roll.
  const sessionSeed = await getSessionSeed(db, sessionId);
  const seed = deriveSeed(sessionSeed, turnNumber);
  const verbMappings = (form as unknown as {
    verbMappings?: Record<string, { rollStat: string | null }>;
  }).verbMappings;
  const rollStat = verbMappings?.[intent.verb]?.rollStat ?? null;
  const mod = rollStat ? (form.stats[rollStat] ?? 0) : 0;
  const roll = roll2d6(seed, mod);
  await appendEvents(db, sessionId, [
    { kind: "roll.resolved", roll, against: rollStat ?? "default" },
  ]);

  // 5. Reload projection so the narrator sees turn.begun + roll context.
  projection = await loadProjection(db, sessionId, form, location);

  // 6. Retrieve relevant memories. Entity bias: any NPC slug from the
  // projection that appears in the sanitized input gets a 0.3× boost.
  const entitySlugs = Object.keys(projection.npcs).filter((slug) =>
    sanitized.toLowerCase().includes(slug.replace(/-/g, " ")) ||
    sanitized.toLowerCase().includes(slug),
  );
  let relevantMemories: import("./types").Memory[] = [];
  try {
    relevantMemories = await retrieveMemories(db, sessionId, sanitized, {
      k: 4,
      entitySlugs,
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
  if (world?.userId && shouldRecallWorld(projection)) {
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
  }

  // 7. Narrate (with one-shot ADR-011 retry on tool-validation failure).
  const baseInput = {
    projection,
    lastEvents: [],
    roll,
    intent: intent.verb,
    relevantMemories,
  };
  // Provider may legitimately fail (BYO key revoked, MiniMax 503,
  // network blip, etc.). When fallbackNarrator is supplied, we
  // graceful-fail to it for THIS TURN ONLY so the run keeps moving.
  // The API surfaces the fallback flag so the UI can banner.
  let narrate: import("./types").NarrateOutput;
  try {
    if (onNarrationStreamDelta && narrator.narrateStream) {
      narrate = await narrator.narrateStream(
        baseInput,
        onNarrationStreamDelta,
      );
    } else {
      narrate = await narrator.narrate(baseInput);
    }
  } catch (err) {
    if (!fallbackNarrator) throw err;
    narratorFallback = true;
    narratorFallbackReason = (
      err instanceof Error ? err.message : String(err)
    ).slice(0, 200);
    log.warn("turn.narrator.fallback", {
      sessionId,
      turn: turnNumber,
      err: narratorFallbackReason,
    });
    narrate = await fallbackNarrator.narrate(baseInput);
  }

  // 8. Validate + apply tools atomically.
  let toolResult = await applyTools(
    db,
    sessionId,
    projection,
    narrate.toolCalls,
  );
  let toolRetried = false;
  let toolFellBack = false;
  if (!toolResult.ok) {
    // ADR-011: re-prompt with the failure, max 1 retry. If the retry
    // fails too, fall back to narrate_only — the narration text from
    // the second attempt is kept; no tools are applied.
    toolRetried = true;
    log.info("turn.tools.retry", {
      sessionId,
      turn: turnNumber,
      tool: toolResult.failure.tool,
      reason: toolResult.failure.error,
    });
    const retry = await narrator.narrate({
      ...baseInput,
      previousAttempt: {
        text: narrate.text,
        toolCalls: narrate.toolCalls,
        failureReason: `tool ${toolResult.failure.tool}: ${toolResult.failure.error}`,
        failureKind: "tool_validation",
      },
    });
    narrate = retry;
    toolResult = await applyTools(db, sessionId, projection, retry.toolCalls);
    if (!toolResult.ok) {
      toolFellBack = true;
      log.warn("turn.tools.fallback_to_narrate_only", {
        sessionId,
        turn: turnNumber,
        tool: toolResult.failure.tool,
      });
    }
  }
  const toolEvents = toolResult.ok ? toolResult.events.length : 0;

  // 9. Tone drift check on the final accepted text.
  //    Regex layer first (fast, free). When llmJudges.useTone is on,
  //    a second-pass LLM judge runs on text the regex passed.
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
    const retry = await narrator.narrate({
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

  // 10. narration.emitted (with the final accepted text).
  await appendEvents(db, sessionId, [
    {
      kind: "narration.emitted",
      text: narrate.text,
      toolCallsApplied: toolEvents,
    },
  ]);

  // 9c. Persist any create_memory tool calls into the memories table
  // with embeddings. The orchestrator already wrote memory.created
  // events via applyTools — this adds the searchable row.
  if (toolResult.ok) {
    for (const tool of narrate.toolCalls) {
      if (tool.name === "create_memory") {
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
    }
  }

  // 10. Match + fire beats (with dedupe across this session's prior beats).
  const beatsFired: string[] = [];
  if (beatPack) {
    const fired = await loadFiredBeats(db, sessionId, beatPack);
    projection = await loadProjection(db, sessionId, form, location);
    const matches = matchBeats(projection, beatPack, fired);
    for (const beat of matches) {
      await appendEvents(db, sessionId, beat.fires);
      beatsFired.push(beat.id);
    }
  }

  // 11. Turn cap check.
  projection = await loadProjection(db, sessionId, form, location);
  if (projection.status === "active" && turnNumber >= turnCap) {
    await appendEvents(db, sessionId, [
      { kind: "session.ended", reason: "cap" },
    ]);
    projection = await loadProjection(db, sessionId, form, location);
  }

  // 11b. World-memory persistence. Fires whenever this turn is the
  // one that landed session.ended (death from damage, win from beats,
  // or cap from above). Idempotent — persistRunToWorld bails if a
  // memory for this campaign already exists. Anon runs (no
  // world.userId) are skipped silently.
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

  // 12. Snapshot.
  await writeSnapshot(db, projection);

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
  });

  return {
    ok: true,
    narration: narrate.text,
    projection,
    toolEvents,
    beatsFired,
    ...(narratorFallback
      ? { narratorFallback: true, narratorFallbackReason }
      : {}),
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

async function loadFiredBeats(
  db: Db,
  sessionId: string,
  pack: BeatPack,
): Promise<Set<string>> {
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
        if (
          projection.quest.objectives[evt.objective] !== undefined
        ) {
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
