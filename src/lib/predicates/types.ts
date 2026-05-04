/**
 * Predicate engine — pure functions over an event-log slice.
 *
 * Three later features ride on this: achievements, daily/weekly
 * objectives, and the legacy-trait imprint classifier. They all want
 * the same primitive: "given these events (and optionally context
 * about the player + projection), did some shape match?"
 *
 * Hard rules:
 *   1. Predicates are SYNCHRONOUS. The slice of events is fetched
 *      once per feature pass; predicates are pure folds over it.
 *   2. Predicates RECOGNIZE shapes; they do NOT fold state. Reducers
 *      already do that — see src/lib/game/projection.ts.
 *   3. Evidence collection is opt-in via the runner. Top-level
 *      predicates that match should be able to surface the events
 *      that *caused* the match (for audit, UI, achievement-unlock
 *      attribution).
 */
import type { Event, EventKind, Projection } from "../game/types";

/**
 * Per-evaluation context. Optional — many predicates only need the
 * events. Features that need to ask "what's the player's id" or
 * "what time is it now" thread it through here.
 */
export interface PredCtx {
  userId?: string | null;
  sessionId?: string;
  /** Projection AT THE END of the event slice. Useful for predicates
   *  that ask "is the player currently dead?" or "do they have item
   *  X right now?" — cheaper than re-folding inside a predicate. */
  projection?: Projection;
  /** Wall-clock for time-windowed predicates. Falls back to now()
   *  when undefined; tests pin this for determinism. */
  now?: Date;
  /** Per-evaluation scratch — used by the runner to thread evidence
   *  collection through nested combinators without re-running. */
  _evidence?: Set<Event>;
}

/**
 * A predicate is a function from (events, ctx) → boolean. Combinators
 * compose these. Custom predicates can be authored inline by feature
 * code (e.g. legacy-trait classifier in src/lib/legacy/imprint.ts).
 */
export type Predicate = (events: readonly Event[], ctx?: PredCtx) => boolean;

/**
 * Runner result. `matched` mirrors what the predicate returned.
 * `evidence` is the subset of events that contributed to a positive
 * match — empty when matched=false, populated when matched=true.
 *
 * Evidence semantics by combinator:
 *   - `all([p1, p2, ...])`     → union of every child's evidence.
 *   - `any([p1, p2, ...])`     → evidence of the first child that
 *                                matched (short-circuit).
 *   - `not(p)`                 → empty (a not-match has no positive
 *                                evidence).
 *   - `count(filter, ">= N")`  → the first N matching events.
 *   - `inOrder([p1, p2, ...])` → one event per slot, in order.
 *   - `eventOfKind(k)`         → the first event matching the kind.
 *   - `havingTool(name)`       → the first event tied to that tool.
 *   - `withinTurns(p, N)`      → child's evidence (unmodified).
 */
export interface EvalResult {
  matched: boolean;
  evidence: Event[];
}

/**
 * Comparator strings for `count`. Matches the shape of the
 * achievements-catalog JSON so designers can write `">= 3"` directly.
 */
export type Comparator =
  | "==" | "!=" | ">" | ">=" | "<" | "<="
  // Authoring style — accept "= 3" as "== 3" for ergonomics.
  | "=";

export type CountSpec = `${Comparator} ${number}` | `${Comparator}${number}`;

/** Pure: parse "= 3" / ">=3" / "!= 0" into { op, value }. */
export function parseCountSpec(spec: CountSpec): { op: Comparator; value: number } {
  const m = /^\s*(==|!=|>=|<=|>|<|=)\s*(-?\d+)\s*$/.exec(spec);
  if (!m) throw new Error(`predicate: invalid count spec '${spec}'`);
  return { op: m[1] as Comparator, value: parseInt(m[2], 10) };
}

export function compareCount(actual: number, spec: CountSpec): boolean {
  const { op, value } = parseCountSpec(spec);
  switch (op) {
    case "==":
    case "=":
      return actual === value;
    case "!=":
      return actual !== value;
    case ">":
      return actual > value;
    case ">=":
      return actual >= value;
    case "<":
      return actual < value;
    case "<=":
      return actual <= value;
  }
}

export type EventKindOrAny = EventKind | "*";

/** Pure: does this event match the kind filter? "*" matches anything. */
export function eventMatchesKind(event: Event, kind: EventKindOrAny): boolean {
  return kind === "*" || event.kind === kind;
}
