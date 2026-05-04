/**
 * JSON-DSL → Predicate parser. Translates the catalog's
 * `predicate` field (a JSON tree) into the in-memory Predicate
 * functions defined in `lib/predicates/dsl.ts`.
 *
 * Supported node types map 1:1 to the engine's combinators:
 *   { type: "all", children: [...] }
 *   { type: "any", children: [...] }
 *   { type: "not", child: ... }
 *   { type: "eventOfKind", kind: "..." }
 *   { type: "eventWith", match: { kind: "...", ... } }
 *   { type: "count", filter: <node>, spec: ">= 3" }
 *   { type: "havingTool", name: "..." }
 *   { type: "inOrder", children: [...] }
 *   { type: "withinTurns", child: <node>, n: 5 }
 *   { type: "true" } / { type: "false" }
 *
 * `eventWith` is the JSON-friendly alternative to whereEvent — it
 * matches an event when every key in `match` equals the event's
 * value at that path. Common deep paths are supported via dotted
 * keys ("data.relationship", "roll.band", etc.).
 *
 * Catalog authors use this DSL in content/achievements.json. The
 * parser validates structurally; an invalid catalog throws at boot
 * so we fail loud rather than silently dropping achievements.
 */
import {
  all,
  any,
  count,
  eventOfKind,
  FALSE,
  havingTool,
  inOrder,
  not,
  TRUE,
  whereEvent,
  withinTurns,
} from "../predicates/dsl";
import type { CountSpec, Predicate } from "../predicates/types";
import type { Event, EventKind, ToolCall } from "../game/types";

export interface DslNode {
  type: string;
  [key: string]: unknown;
}

/** Parse a JSON DSL node into an executable Predicate. */
export function parsePredicate(node: DslNode | unknown): Predicate {
  if (!node || typeof node !== "object" || !("type" in node)) {
    throw new Error(`predicate-dsl: expected object with 'type', got ${typeof node}`);
  }
  const n = node as DslNode;
  switch (n.type) {
    case "all":
      return all(asArray(n.children).map(parsePredicate));
    case "any":
      return any(asArray(n.children).map(parsePredicate));
    case "not":
      return not(parsePredicate(n.child));
    case "true":
      return TRUE;
    case "false":
      return FALSE;
    case "eventOfKind":
      return eventOfKind(asString(n.kind) as EventKind);
    case "eventWith":
      return whereEvent(matcherFromObject(asObject(n.match)));
    case "count":
      return count(parsePredicate(n.filter), asString(n.spec) as CountSpec);
    case "havingTool":
      return havingTool(asString(n.name) as ToolCall["name"]);
    case "inOrder":
      return inOrder(asArray(n.children).map(parsePredicate));
    case "withinTurns":
      return withinTurns(parsePredicate(n.child), asNumber(n.n));
    default:
      throw new Error(`predicate-dsl: unknown node type '${String(n.type)}'`);
  }
}

/**
 * Build a single-event matcher from a partial-equality object.
 * Supports dotted keys for nested fields:
 *   { "kind": "session.ended", "reason": "death" }
 *   { "kind": "roll.resolved", "roll.band": "success" }
 *   { "kind": "damage.applied", "amount": { "$gte": 5 } }
 *
 * The `$gte` / `$gt` / `$lte` / `$lt` / `$ne` operators allow
 * numeric/string comparisons. Plain values (string / number /
 * boolean) match by strict equality.
 */
function matcherFromObject(match: Record<string, unknown>): (e: Event) => boolean {
  return (event: Event) => {
    for (const [path, expected] of Object.entries(match)) {
      const actual = pluck(event as unknown as Record<string, unknown>, path);
      if (!matchesValue(actual, expected)) return false;
    }
    return true;
  };
}

function pluck(obj: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return obj[path];
  const parts = path.split(".");
  let cursor: unknown = obj;
  for (const p of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[p];
  }
  return cursor;
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (
    expected !== null &&
    typeof expected === "object" &&
    !Array.isArray(expected)
  ) {
    // Operator object — { $gte: 5 } etc.
    for (const [op, value] of Object.entries(expected)) {
      switch (op) {
        case "$eq":
          if (actual !== value) return false;
          break;
        case "$ne":
          if (actual === value) return false;
          break;
        case "$gt":
          if (typeof actual !== "number" || typeof value !== "number") return false;
          if (!(actual > value)) return false;
          break;
        case "$gte":
          if (typeof actual !== "number" || typeof value !== "number") return false;
          if (!(actual >= value)) return false;
          break;
        case "$lt":
          if (typeof actual !== "number" || typeof value !== "number") return false;
          if (!(actual < value)) return false;
          break;
        case "$lte":
          if (typeof actual !== "number" || typeof value !== "number") return false;
          if (!(actual <= value)) return false;
          break;
        case "$in":
          if (!Array.isArray(value) || !value.includes(actual)) return false;
          break;
        case "$contains":
          if (typeof actual !== "string" || typeof value !== "string") return false;
          if (!actual.includes(value)) return false;
          break;
        case "$matches":
          if (typeof actual !== "string" || typeof value !== "string") return false;
          if (!new RegExp(value, "i").test(actual)) return false;
          break;
        default:
          throw new Error(`predicate-dsl: unknown operator '${op}'`);
      }
    }
    return true;
  }
  return actual === expected;
}

// Type-safe coercion helpers
function asString(v: unknown): string {
  if (typeof v !== "string") throw new Error(`predicate-dsl: expected string, got ${typeof v}`);
  return v;
}
function asNumber(v: unknown): number {
  if (typeof v !== "number") throw new Error(`predicate-dsl: expected number, got ${typeof v}`);
  return v;
}
function asArray(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new Error(`predicate-dsl: expected array, got ${typeof v}`);
  return v;
}
function asObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`predicate-dsl: expected object, got ${typeof v}`);
  }
  return v as Record<string, unknown>;
}
