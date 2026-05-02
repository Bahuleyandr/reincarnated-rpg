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

export interface Beat {
  id: string;
  displayName?: string;
  trigger: Trigger;
  narrative?: string;
  oncePerSession?: boolean;
  fires: Event[];
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
