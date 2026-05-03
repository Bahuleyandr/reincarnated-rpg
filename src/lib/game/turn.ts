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

  // 6. Narrate.
  const narrate = await narrator.narrate({
    projection,
    lastEvents: [],
    roll,
    intent: intent.verb,
    relevantMemories: [],
  });

  // 7. Validate + apply tools atomically.
  const toolResult = await applyTools(
    db,
    sessionId,
    projection,
    narrate.toolCalls,
  );
  // Day-6: no retry. Day-12 adds the orchestrator-side retry.
  const toolEvents = toolResult.ok ? toolResult.events.length : 0;

  // 8. narration.emitted.
  await appendEvents(db, sessionId, [
    {
      kind: "narration.emitted",
      text: narrate.text,
      toolCallsApplied: toolEvents,
    },
  ]);

  // 8b. Tone drift check (free regex layer; Haiku judge optional, off
  // by default). Day-9 logs only — Day 12 wires the regen retry.
  const tone = checkToneFast(narrate.text, form);
  if (!tone.ok) {
    log.warn("turn.tone.violation", {
      sessionId,
      turn: turnNumber,
      violations: tone.violations,
    });
  }

  // 9. Match + fire beats (with dedupe across this session's prior beats).
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

  // 10. Turn cap check.
  projection = await loadProjection(db, sessionId, form, location);
  if (projection.status === "active" && turnNumber >= turnCap) {
    await appendEvents(db, sessionId, [
      { kind: "session.ended", reason: "cap" },
    ]);
    projection = await loadProjection(db, sessionId, form, location);
  }

  // 11. Snapshot.
  await writeSnapshot(db, projection);

  log.info("turn.complete", {
    sessionId,
    turn: turnNumber,
    verb: intent.verb,
    band: roll.band,
    toolEvents,
    beatsFired: beatsFired.length,
    durationMs: Date.now() - t0,
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
