/**
 * Beat matcher.
 *
 * A beat is a one-shot scripted moment with a trigger predicate over the
 * current projection. When the predicate matches, the orchestrator
 * appends the beat's `fires` events alongside the turn's tool-call events.
 *
 * Trigger DSL:
 *   `{ "turn": ">=5" }`              — numeric on `projection.turn`
 *   `{ "location.roomId": "==seam" }` — equality on a dotted path
 *   `{ "form.vitals.cohesion": "<=2" }`
 *   `{ "npcKnown": "tunnel-rat-1" }`  — projection.npcs has the slug
 *   `{ "discovered": "moss-vault" }`  — location.discovered includes
 *   `{ "all": [ ... ] }` / `{ "any": [ ... ] }` — boolean composition
 *
 * Once-per-session beats (the common case) are deduped via the
 * `firedBeats` set the caller threads in. The reducer never persists
 * "this beat fired" directly — that would be reverse-engineering state
 * from beat IDs. Instead, beats almost always fire `quest.objectiveUpdated`
 * which gives the same effect via projection.quest.objectives.
 *
 * Day-5 scope: matcher + DSL evaluator. Wiring into the orchestrator
 * lands Day 6 (turn.ts).
 */
import type { Event, Projection } from "./types";

/**
 * Phase 11 P9 — verb-button suggestion attached to a beat.
 *
 * When a beat's trigger matches AND `suggestedVerbs` is populated,
 * the play page renders these as preset buttons next to the input.
 * The player can pick one (deterministic template path) or "say
 * something else" (escape hatch, routes to the LLM narrator).
 *
 * Each suggestion is a coherent in-world action the arc author
 * wants the player to consider. The button label is short; the
 * description is the hover/secondary text. Choice is the
 * mechanism; direction is the author's.
 */
export interface SuggestedVerb {
  /** The verb id from the form's verbs[] / verbMappings. The
   *  orchestrator normalises the player's input to this verb when
   *  the preset is picked. */
  verb: string;
  /** Short, imperative button label ("shape a new room"). */
  label: string;
  /** One-line flavor under the label. */
  description: string;
  /** Optional: marks whether this verb advances the arc to the
   *  next beat. The UI uses this to render a small "▸" marker.
   *  Some verbs may branch to a sibling beat — those use the
   *  literal `branch:<target>` form. Falsy = stays in the current
   *  beat (a "wait one more turn" or flavor option). */
  advancesArc?: boolean | string;
}

/**
 * Phase 11+ — suggestedVerbs can be either:
 *
 *   1. A flat array — applies to whatever form is playing this
 *      beat. Used for form-specific arcs (defend-the-deep is for
 *      dungeon-core; survive-the-night is for slime; etc.).
 *
 *   2. A per-form record — keyed by `form.id`, with an optional
 *      `default` fallback. Used for form-agnostic arcs like
 *      `read-the-room` that work across slime/book/egg/core/
 *      generic-creature; the buttons need to dispatch on the
 *      player's current form because those forms have almost no
 *      verbs in common.
 *
 * The runtime resolver lives in `verb-suggestions.ts` →
 * `pickFormSuggestions()`. Authoring convention: prefer the flat
 * array unless the beat is form-agnostic.
 */
export type SuggestedVerbsField =
  | SuggestedVerb[]
  | Record<string, SuggestedVerb[]>;

export interface Beat {
  id: string;
  displayName?: string;
  trigger: Trigger;
  narrative?: string;
  oncePerSession?: boolean;
  fires: Event[];
  /** Phase 11 P9 — three preset verbs the arc author wants the
   *  player to choose from when this beat is active. Optional
   *  per beat; when absent, the play page falls back to the
   *  form's iconicVerbs. */
  suggestedVerbs?: SuggestedVerbsField;
}

export interface Trigger {
  all?: Trigger[];
  any?: Trigger[];
  [key: string]: string | Trigger[] | undefined;
}

export interface BeatPack {
  id: string;
  displayName?: string;
  questId?: string;
  introTurnCap?: number;
  beats: Beat[];
}

export function matchBeats(
  projection: Projection,
  pack: BeatPack,
  firedBeats: Set<string>,
): Beat[] {
  const matched: Beat[] = [];
  for (const beat of pack.beats) {
    if (beat.oncePerSession && firedBeats.has(beat.id)) continue;
    if (evaluate(beat.trigger, projection)) matched.push(beat);
  }
  return matched;
}

export function evaluate(trigger: Trigger, projection: Projection): boolean {
  if (Array.isArray(trigger.all)) {
    if (!trigger.all.every((t) => evaluate(t, projection))) return false;
  }
  if (Array.isArray(trigger.any)) {
    if (!trigger.any.some((t) => evaluate(t, projection))) return false;
  }
  for (const [key, valueRaw] of Object.entries(trigger)) {
    if (key === "all" || key === "any") continue;
    if (typeof valueRaw !== "string") continue;
    if (key === "npcKnown") {
      if (!(valueRaw in projection.npcs)) return false;
      continue;
    }
    if (key === "discovered") {
      if (!projection.location.discovered.includes(valueRaw)) return false;
      continue;
    }
    const lhs = pluck(projection, key);
    if (!compareValue(lhs, valueRaw)) return false;
  }
  return true;
}

function pluck(state: Projection, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = state;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function compareValue(lhs: unknown, expr: string): boolean {
  // Operators: ==, !=, >=, <=, >, < (prefix). Default: ==.
  const ops: Array<[string, (a: number, b: number) => boolean] | [string, (a: unknown, b: string) => boolean]> = [
    ["==", (a: unknown, b: string) => String(a) === b],
    ["!=", (a: unknown, b: string) => String(a) !== b],
    [">=", (a: number, b: number) => Number(a) >= Number(b)],
    ["<=", (a: number, b: number) => Number(a) <= Number(b)],
    [">", (a: number, b: number) => Number(a) > Number(b)],
    ["<", (a: number, b: number) => Number(a) < Number(b)],
  ];
  for (const [op, fn] of ops) {
    if (expr.startsWith(op)) {
      const rhs = expr.slice(op.length);
      // @ts-expect-error — heterogeneous fn signatures
      return fn(lhs, rhs);
    }
  }
  // Default: equality with stringified RHS.
  return String(lhs) === expr;
}
