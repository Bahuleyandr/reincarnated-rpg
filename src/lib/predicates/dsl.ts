/**
 * Predicate combinators. Pure, synchronous, evidence-collecting.
 *
 * Each combinator returns a `Predicate` that — when invoked through
 * the runner — also writes its contributing events into
 * `ctx._evidence`. Top-level callers use the runner (see
 * `runner.ts`) which initializes that scratch set.
 *
 * Evidence policy is documented per-combinator in `types.ts`
 * (EvalResult JSDoc). The shape: positive matches collect evidence,
 * negative matches collect none.
 */
import type { Event, ToolCall } from "../game/types";

import {
  compareCount,
  eventMatchesKind,
  type CountSpec,
  type EventKindOrAny,
  type PredCtx,
  type Predicate,
} from "./types";

function record(ctx: PredCtx | undefined, event: Event): void {
  ctx?._evidence?.add(event);
}

function recordAll(ctx: PredCtx | undefined, events: readonly Event[]): void {
  if (!ctx?._evidence) return;
  for (const event of events) ctx._evidence.add(event);
}

// ---------------------------------------------------------------- //
// Boolean combinators
// ---------------------------------------------------------------- //

/** AND. Every child must match; evidence is the union. Empty list → true (vacuously). */
export function all(children: readonly Predicate[]): Predicate {
  return (events, ctx) => {
    if (children.length === 0) return true;
    // Two-phase: first check ALL children match (without recording).
    // Only record on a confirmed match — partial matches don't pollute
    // the evidence set.
    const probe: PredCtx = { ...ctx, _evidence: new Set<Event>() };
    for (const child of children) {
      if (!child(events, probe)) return false;
    }
    if (ctx?._evidence) {
      for (const event of probe._evidence!) ctx._evidence.add(event);
    }
    return true;
  };
}

/** OR. First match wins; evidence is that child's only. */
export function any(children: readonly Predicate[]): Predicate {
  return (events, ctx) => {
    if (children.length === 0) return false;
    for (const child of children) {
      const probe: PredCtx = { ...ctx, _evidence: new Set<Event>() };
      if (child(events, probe)) {
        if (ctx?._evidence) {
          for (const event of probe._evidence!) ctx._evidence.add(event);
        }
        return true;
      }
    }
    return false;
  };
}

/** NOT. Inverts. Never collects evidence (a non-match has no positive proof). */
export function not(p: Predicate): Predicate {
  return (events, ctx) => {
    // Use a discarded probe so the inner predicate's evidence doesn't
    // bleed up even on the inverted side.
    const probe: PredCtx = { ...ctx, _evidence: new Set<Event>() };
    return !p(events, probe);
  };
}

// ---------------------------------------------------------------- //
// Atom predicates
// ---------------------------------------------------------------- //

/** True if at least one event has this kind. Evidence: the first match. */
export function eventOfKind(kind: EventKindOrAny): Predicate {
  return (events, ctx) => {
    for (const event of events) {
      if (eventMatchesKind(event, kind)) {
        record(ctx, event);
        return true;
      }
    }
    return false;
  };
}

/** True if at least one event matches a custom predicate over a single
 *  event. Evidence: the first match. The cheap escape-hatch when the
 *  built-in combinators don't quite say what you want. */
export function whereEvent(predicate: (event: Event) => boolean): Predicate {
  return (events, ctx) => {
    for (const event of events) {
      if (predicate(event)) {
        record(ctx, event);
        return true;
      }
    }
    return false;
  };
}

/**
 * True if the count of events matching `filter` satisfies the
 * comparator spec. e.g. `count(eventOfKind('damage.applied'), ">= 3")`.
 *
 * The filter is itself a Predicate so you can compose: count of
 * "damage events with amount > 5" via `whereEvent`.
 */
export function count(
  filter: Predicate,
  spec: CountSpec,
): Predicate {
  return (events, ctx) => {
    const matches: Event[] = [];
    for (const event of events) {
      // Probe each event individually — the filter is treated as a
      // single-event-slice predicate.
      const probe: PredCtx = { ...ctx, _evidence: new Set<Event>() };
      if (filter([event], probe)) matches.push(event);
    }
    if (!compareCount(matches.length, spec)) return false;
    // Evidence: the events that contributed up to the satisfying
    // count (for `>= N`, the first N; for `== N` all of them; etc.)
    const sample = sampleEvidence(matches.length, spec, matches);
    recordAll(ctx, sample);
    return true;
  };
}

function sampleEvidence(actual: number, spec: CountSpec, matches: Event[]): Event[] {
  // For ">= N" / "> N": surface the first events that crossed the line.
  // For "== N" / "= N": surface all of them.
  // For "<= N" / "< N" / "!= N": surface up to the first N (or all when
  // fewer matched) — useful to show what was counted.
  const m = /^\s*([<>=!]=?|=)\s*(-?\d+)\s*$/.exec(spec);
  if (!m) return matches;
  const op = m[1];
  const value = parseInt(m[2], 10);
  if (op === ">=" || op === ">") return matches.slice(0, value);
  if (op === "==" || op === "=") return matches;
  return matches.slice(0, Math.max(value, 1));
  void actual;
}

// ---------------------------------------------------------------- //
// Tool-aware predicates
// ---------------------------------------------------------------- //

/**
 * True if any event in the slice was produced by the given tool.
 * Tools don't appear directly in events — each tool maps to a
 * specific event kind via toolToEvent (src/lib/game/tools.ts).
 *
 * For most tools the mapping is 1:1 (apply_damage → damage.applied,
 * heal → healed, etc.). `narrate_only` produces no event. We don't
 * import the mapping table to keep this layer free of game-coupling;
 * instead we use a stable name → kind list known at this layer.
 */
const TOOL_TO_KINDS: Record<ToolCall["name"], readonly string[]> = {
  apply_damage: ["damage.applied"],
  heal: ["healed"],
  change_form_state: ["form_state.changed"],
  add_inventory: ["inventory.added"],
  remove_inventory: ["inventory.removed"],
  absorb: ["absorbed"],
  move_to: ["moved"],
  pass_time: ["time.passed"],
  sense: ["sensed"],
  discover_location: ["location.discovered"],
  introduce_npc: ["npc.introduced"],
  update_relationship: ["relationship.updated"],
  update_quest_objective: ["quest.objectiveUpdated"],
  grant_xp: ["xp.granted"],
  create_memory: ["memory.created"],
  // Phase 5 Day 18-19: trade_with_npc emits 3 events in a batch
  // (trade.completed + inventory.added/removed + coins.spent/gained).
  // Listing all of them lets `havingTool('trade_with_npc')` match
  // either the audit event or the side-effect events.
  trade_with_npc: [
    "trade.completed",
    "coins.gained",
    "coins.spent",
  ],
  // Phase 5 Day 21: gather_resource emits craft.gathered + inventory.added.
  gather_resource: ["craft.gathered"],
  // Phase 5 Day 22: craft_recipe emits craft.completed + inventory
  // mutations + xp.granted.
  craft_recipe: ["craft.completed"],
  narrate_only: [],
};

export function havingTool(name: ToolCall["name"]): Predicate {
  const kinds = new Set(TOOL_TO_KINDS[name] ?? []);
  return (events, ctx) => {
    if (kinds.size === 0) return false;
    for (const event of events) {
      if (kinds.has(event.kind)) {
        record(ctx, event);
        return true;
      }
    }
    return false;
  };
}

// ---------------------------------------------------------------- //
// Sequence + windowing
// ---------------------------------------------------------------- //

/**
 * `inOrder([p1, p2, p3])` matches when there exist disjoint events
 * e1 < e2 < e3 (by index in the slice) such that p1 matches the
 * prefix ending at e1, p2 the slice starting after e1 ending at e2,
 * etc. Evidence collects one representative per slot.
 *
 * Implementation uses greedy left-to-right matching — the cheapest
 * thing that's right for the achievements use case (e.g. "harm an
 * NPC THEN later help that same NPC"). Doesn't backtrack; if your
 * predicates need cross-slot constraints, write a custom one.
 */
export function inOrder(children: readonly Predicate[]): Predicate {
  return (events, ctx) => {
    if (children.length === 0) return true;
    let cursor = 0;
    const slotEvidence: Event[] = [];
    for (const child of children) {
      let matched = false;
      // Probe successive sub-slices until we find one that satisfies
      // this slot.
      for (let i = cursor; i < events.length; i++) {
        const slice = events.slice(cursor, i + 1);
        const probe: PredCtx = { ...ctx, _evidence: new Set<Event>() };
        if (child(slice, probe)) {
          matched = true;
          // Pick the latest event in the matching prefix as the
          // anchor for this slot's evidence.
          const anchor = slice[slice.length - 1];
          slotEvidence.push(anchor);
          cursor = i + 1;
          break;
        }
      }
      if (!matched) return false;
    }
    recordAll(ctx, slotEvidence);
    return true;
  };
}

/**
 * `withinTurns(p, N)` restricts evaluation to events that occurred
 * in the last N turns (counted by `turn.begun` events). If the slice
 * has fewer than N turns, the whole slice is used.
 */
export function withinTurns(p: Predicate, n: number): Predicate {
  if (n <= 0) {
    // Pathological — empty window can't match anything by definition.
    return () => false;
  }
  return (events, ctx) => {
    // Walk backwards finding turn.begun events. Once we've passed N
    // of them, slice from there.
    const turnStarts: number[] = [];
    for (let i = 0; i < events.length; i++) {
      if (events[i].kind === "turn.begun") turnStarts.push(i);
    }
    if (turnStarts.length <= n) {
      return p(events, ctx);
    }
    const start = turnStarts[turnStarts.length - n];
    return p(events.slice(start), ctx);
  };
}

// ---------------------------------------------------------------- //
// Trivial constants — useful in catalog authoring
// ---------------------------------------------------------------- //

export const TRUE: Predicate = () => true;
export const FALSE: Predicate = () => false;
