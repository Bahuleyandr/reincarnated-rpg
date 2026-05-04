/**
 * Foreshadowing memory plants (Phase 4.5 Day 16). Pure rules
 * decide which events deserve to plant an echo memory; the echo
 * surfaces as a redacted hint for a few turns before the full
 * memory becomes retrievable.
 *
 * Plant-trigger rules (deliberately sparse — too many ruins the
 * tone):
 *   - npc.introduced: a face you'll see again. Surface in 3 turns.
 *   - location.discovered: a path you'll walk again. Surface in 4.
 *   - quest.objectiveUpdated to 'open': a thread that will pull
 *     on you. Surface in 2.
 *
 * The hint strings are deterministic templates — no LLM call (we
 * don't want to leak narration context, and per-turn LLM hits
 * are expensive). Generation is a pure function of the source
 * event.
 *
 * Plant ceiling: at most 1 echo per turn so the prose doesn't
 * drown in foreshadowing. The first qualifying event in
 * pendingEvents wins.
 */
import type { Event } from "../game/types";

export interface EchoPlan {
  /** Memory summary that becomes available once the echo surfaces. */
  fullSummary: string;
  /** Redacted teaser shown while the echo is pending. */
  hint: string;
  /** Surface this echo when projection.turn >= currentTurn + this. */
  surfaceInTurns: number;
}

const ECHO_RULES: Array<(event: Event) => EchoPlan | null> = [
  (e) => {
    if (e.kind !== "npc.introduced") return null;
    const name = e.data?.name ?? "a stranger";
    return {
      fullSummary: `${name} entered your awareness here. They will surface again.`,
      hint: `you remember a face you have not yet learned.`,
      surfaceInTurns: 3,
    };
  },
  (e) => {
    if (e.kind !== "location.discovered") return null;
    return {
      fullSummary: `You found ${e.locationId}. The path back will matter.`,
      hint: `you remember a passage you took, though you have not yet returned to it.`,
      surfaceInTurns: 4,
    };
  },
  (e) => {
    if (e.kind !== "quest.objectiveUpdated" || e.status !== "open") return null;
    return {
      fullSummary: `${e.objective} began here. Threads pull harder than they look.`,
      hint: `you remember a thread tugging — but you cannot say where it leads.`,
      surfaceInTurns: 2,
    };
  },
];

/**
 * Pure: pick at most one event from `events` to plant as an echo.
 * Returns the plant plan or null. Caller writes the row.
 *
 * Order of preference matches ECHO_RULES order — earlier rules
 * shadow later ones if multiple events match.
 */
export function pickEchoPlant(events: readonly Event[]): {
  source: Event;
  plan: EchoPlan;
} | null {
  for (const event of events) {
    for (const rule of ECHO_RULES) {
      const plan = rule(event);
      if (plan) return { source: event, plan };
    }
  }
  return null;
}

/**
 * For a memory row, decide what to surface based on current turn:
 *   - if surfaceAfterTurn is null → surface the full summary.
 *   - if currentTurn >= surfaceAfterTurn → surface the full
 *     summary (echo has matured).
 *   - otherwise → surface the echoHint, NOT the full summary.
 */
export function effectiveMemorySummary(
  memory: {
    summary: string;
    surfaceAfterTurn: number | null;
    echoHint: string | null;
  },
  currentTurn: number,
): string {
  if (memory.surfaceAfterTurn === null || currentTurn >= memory.surfaceAfterTurn) {
    return memory.summary;
  }
  return memory.echoHint ?? memory.summary;
}
