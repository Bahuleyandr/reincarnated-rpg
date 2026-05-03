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

import { matchBeats, type BeatPack } from "./beats";
import { appendEvents, readLog, rowToEvent } from "./events";
import { loadProjection, writeSnapshot } from "./projection";
import { classify } from "./classify";
import { roll2d6 } from "./rules";
import { sanitizePlayerInput } from "./sanitize";
import { checkToneFast } from "./tone";
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
  beatPack?: BeatPack;
  /** Cap turn count; if reached, fire session.ended('cap'). Default 10. */
  turnCap?: number;
}

export interface TurnResult {
  ok: true;
  narration: string;
  projection: Projection;
  toolEvents: number;
  beatsFired: string[];
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
    beatPack,
    turnCap = 10,
  } = args;

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

  // 3. Classify intent.
  const intent = classify(sanitized, form);
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

  // 7. Narrate (with one-shot ADR-011 retry on tool-validation failure).
  const baseInput = {
    projection,
    lastEvents: [],
    roll,
    intent: intent.verb,
    relevantMemories,
  };
  let narrate = await narrator.narrate(baseInput);

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

  // 9. Tone drift check on the final accepted text. If the regex layer
  // catches negativeVocab, re-narrate once for prose only — the tools
  // are already applied (or fallen-back) and don't get re-emitted.
  let tone = checkToneFast(narrate.text, form);
  let toneRetried = false;
  if (!tone.ok) {
    toneRetried = true;
    log.info("turn.tone.retry", {
      sessionId,
      turn: turnNumber,
      violations: tone.violations,
    });
    const retry = await narrator.narrate({
      ...baseInput,
      previousAttempt: {
        text: narrate.text,
        toolCalls: narrate.toolCalls,
        failureReason: `tone violations: ${tone.violations.join(", ")}`,
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
