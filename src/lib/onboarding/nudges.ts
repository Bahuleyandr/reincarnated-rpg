/**
 * Onboarding nudges — POLISH_PLAN sub-phase 0c.5 (deferred → unblocked
 * by the predicate engine that shipped in Phase 1).
 *
 * Goal: a first-time player gets contextual hints in their first ~5
 * turns, without being intrusive. Each nudge has a priority + a
 * predicate over the session's event log + projection. The first
 * un-dismissed nudge whose predicate matches is surfaced as a small
 * banner above the verb-button surface on /play.
 *
 * Dismissal is client-side (localStorage). Anon-friendly; survives
 * page reloads in the same browser; doesn't require a DB row.
 *
 * Each nudge's predicate is intentionally PURE — it reads events +
 * projection and returns a boolean. No tool execution, no narration
 * side effects, no LLM calls. This keeps nudges cheap to evaluate
 * (we run the catalog every turn).
 */
import type { Event, Projection } from "../game/types";

export interface Nudge {
  /** Stable id used by the dismissal store. Lowercase, hyphenated. */
  id: string;
  /** Player-visible message. ~1 sentence. May reference the form
   *  via {form} substitutions if needed (none today). */
  text: string;
  /** Lower number = higher priority. Multiple matching nudges are
   *  ranked by priority; the runner picks the smallest. */
  priority: number;
  /** Pure predicate over the session's event slice + the post-turn
   *  projection. Signals that this nudge is currently RELEVANT. */
  match(events: readonly Event[], projection: Projection): boolean;
}

interface RunnerArgs {
  events: readonly Event[];
  projection: Projection;
  /** Ids the player has already dismissed in this browser. */
  dismissedIds: readonly string[];
}

export interface NudgeResult {
  /** The nudge that was surfaced, or null if nothing matched (or
   *  every match was already dismissed). */
  nudge: Nudge | null;
}

// ---- Catalog --------------------------------------------------------

/**
 * The ordered catalog. Priority is the field on each entry, NOT the
 * array order — the runner sorts by priority. Lower number wins.
 *
 * Authoring guidance:
 *   - One sentence, second-person, lowercase tone (matches the rest
 *     of the UI's voice).
 *   - Predicates should be specific enough that they only fire when
 *     the player is actually in that situation. False positives are
 *     way worse than false negatives — a wrong nudge feels patronising.
 */
export const NUDGES: Nudge[] = [
  {
    id: "first-look",
    priority: 10,
    text:
      "pick one of the three preset buttons below to begin — each is guaranteed to fit your form's voice.",
    match: (events, projection) => {
      // Hasn't taken any turn yet. The session has events
      // (session.started, etc.) but no turn.begun.
      if (projection.turn !== 0) return false;
      return !events.some((e) => e.kind === "turn.begun");
    },
  },

  {
    id: "explore-an-exit",
    priority: 20,
    text:
      "move to a connected room to discover the location — only visited rooms unlock fog-of-war on the map.",
    match: (events, projection) => {
      // 3+ turns, but only one room discovered.
      if (projection.turn < 3) return false;
      if (projection.location.discovered.length > 1) return false;
      return true;
    },
  },

  {
    id: "try-free-text",
    priority: 30,
    text:
      "the ✎ tile below the preset buttons opens free-text input — your words route through the LLM narrator.",
    match: (events, projection) => {
      // Turn 4+ and the player has been picking presets only (no
      // event from a free-text path). Heuristic: no narration text
      // longer than ~4× a typical preset response. We keep it
      // simple — just gate on turn count and never show before
      // they've felt the rhythm.
      if (projection.turn < 4) return false;
      const hasNarration =
        events.filter((e) => e.kind === "narration.emitted").length >= 4;
      return hasNarration;
    },
  },

  {
    id: "vital-low",
    priority: 5, // higher priority than the first-time hints — survival matters
    text:
      "your form's primary vital is low — try a defensive preset to recover.",
    match: (events, projection) => {
      // First vital with a non-null death threshold; fire when below
      // 30% of max. Avoids firing on stat-vitals that don't kill.
      for (const [name, threshold] of Object.entries(
        projection.form.vitalsDeath,
      )) {
        if (threshold === null) continue;
        const current = projection.form.vitals[name] ?? 0;
        const max = projection.form.vitalsMax[name] ?? 0;
        if (max <= 0) continue;
        const ratio = (current - threshold) / (max - threshold);
        if (ratio <= 0.3) return true;
      }
      return false;
    },
  },

  {
    id: "wyrm-watching",
    priority: 40,
    text:
      "the long wyrm has noticed your form. its eye is on the world; the world remembers what it sees.",
    match: (_events, projection) => {
      const attuned = projection.form.state["wyrm_attuned"] ?? 0;
      return typeof attuned === "number" && attuned >= 1;
    },
  },

  {
    id: "branch-taken",
    priority: 50,
    text:
      "you took a branch in the arc — beats further on may now fork. the ↳ marker on a verb means it forks the story.",
    match: (_events, projection) => {
      // Any form.state field starting with "branch_" with value >= 1.
      for (const [k, v] of Object.entries(projection.form.state)) {
        if (k.startsWith("branch_") && typeof v === "number" && v >= 1) {
          return true;
        }
      }
      return false;
    },
  },
];

// ---- Runner ---------------------------------------------------------

/**
 * Pick the highest-priority un-dismissed nudge whose predicate matches.
 * Returns { nudge: null } when nothing applies.
 */
export function pickNudge(args: RunnerArgs): NudgeResult {
  const dismissed = new Set(args.dismissedIds);
  const matched = NUDGES
    .filter((n) => !dismissed.has(n.id))
    .filter((n) => {
      try {
        return n.match(args.events, args.projection);
      } catch {
        // Predicate threw — treat as no-match, log nothing (this is
        // hot-path code, called every turn).
        return false;
      }
    })
    .sort((a, b) => a.priority - b.priority);
  return { nudge: matched[0] ?? null };
}

/**
 * Test-only: lookup by id. Returns null when no such nudge.
 */
export function findNudgeById(id: string): Nudge | null {
  return NUDGES.find((n) => n.id === id) ?? null;
}
