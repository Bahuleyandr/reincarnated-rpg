/**
 * Public entry point for evaluating predicates.
 *
 * The combinators in `dsl.ts` thread an `_evidence` set through ctx
 * via mutation. Top-level callers don't construct that set themselves
 * — `evaluate()` does it. Result is a clean `{ matched, evidence }`
 * shape that's safe to forward to UI / DB / logs.
 *
 * Example:
 *   const p = inOrder([
 *     whereEvent((e) => e.kind === "relationship.updated" && e.delta < 0),
 *     whereEvent((e) => e.kind === "relationship.updated" && e.delta > 0),
 *   ]);
 *   const { matched, evidence } = evaluate(p, events);
 *   if (matched) unlockAchievement("reformed", evidence);
 */
import type { Event } from "../game/types";

import type { EvalResult, PredCtx, Predicate } from "./types";

export function evaluate(
  predicate: Predicate,
  events: readonly Event[],
  ctx: Omit<PredCtx, "_evidence"> = {},
): EvalResult {
  const evidence = new Set<Event>();
  const matched = predicate(events, { ...ctx, _evidence: evidence });
  return {
    matched,
    evidence: matched ? Array.from(evidence) : [],
  };
}
