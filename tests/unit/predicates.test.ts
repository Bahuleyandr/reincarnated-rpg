/**
 * Predicate engine — every combinator round-tripped against synthetic
 * event arrays. Coverage targets:
 *   - all / any / not (boolean composition)
 *   - eventOfKind / whereEvent (atoms)
 *   - count with each comparator (== / != / > / >= / < / <= / =)
 *   - havingTool (per ToolCall name)
 *   - inOrder (greedy left-to-right matching)
 *   - withinTurns (turn-windowed restriction)
 *   - parseCountSpec / compareCount (helpers)
 *   - evidence collection on matched predicates
 *   - vacuous edge cases (empty event slice, empty children)
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
} from "@/lib/predicates/dsl";
import { evaluate } from "@/lib/predicates/runner";
import {
  compareCount,
  eventMatchesKind,
  parseCountSpec,
} from "@/lib/predicates/types";
import type { Event } from "@/lib/game/types";

// ---------------------------------------------------------------- //
// Synthetic event helpers
// ---------------------------------------------------------------- //

function turnBegun(turn: number): Event {
  return { kind: "turn.begun", turn, input: "x", inputSanitized: "x" };
}
function damage(amount: number, source = "rat"): Event {
  return {
    kind: "damage.applied",
    target: "$SELF",
    amount,
    source,
  };
}
function healed(amount: number): Event {
  return { kind: "healed", target: "$SELF", amount };
}
function relationship(npcId: string, delta: number): Event {
  return { kind: "relationship.updated", npcId, delta, reason: "test" };
}
function ended(reason: "death" | "win" | "cap"): Event {
  return { kind: "session.ended", reason };
}

// ---------------------------------------------------------------- //
// Spec parsing helpers
// ---------------------------------------------------------------- //

describe("parseCountSpec", () => {
  test.each([
    [">=3", { op: ">=", value: 3 }],
    [">= 3", { op: ">=", value: 3 }],
    ["= 5", { op: "=", value: 5 }],
    ["==5", { op: "==", value: 5 }],
    ["!= 0", { op: "!=", value: 0 }],
    ["< 10", { op: "<", value: 10 }],
    ["<= 10", { op: "<=", value: 10 }],
    ["> -1", { op: ">", value: -1 }],
  ])("parses %s", (input, expected) => {
    expect(parseCountSpec(input as never)).toEqual(expected);
  });

  test("throws on garbage", () => {
    expect(() => parseCountSpec("not a count" as never)).toThrow();
  });
});

describe("compareCount", () => {
  test("each comparator", () => {
    expect(compareCount(3, ">= 3")).toBe(true);
    expect(compareCount(2, ">= 3")).toBe(false);
    expect(compareCount(3, "== 3")).toBe(true);
    expect(compareCount(3, "= 3")).toBe(true);
    expect(compareCount(4, "!= 3")).toBe(true);
    expect(compareCount(3, "!= 3")).toBe(false);
    expect(compareCount(2, "< 3")).toBe(true);
    expect(compareCount(3, "< 3")).toBe(false);
    expect(compareCount(3, "<= 3")).toBe(true);
    expect(compareCount(4, "> 3")).toBe(true);
    expect(compareCount(3, "> 3")).toBe(false);
  });
});

describe("eventMatchesKind", () => {
  test('"*" wildcard matches anything', () => {
    expect(eventMatchesKind(damage(1), "*")).toBe(true);
  });
  test("exact kind match", () => {
    expect(eventMatchesKind(damage(1), "damage.applied")).toBe(true);
    expect(eventMatchesKind(damage(1), "healed")).toBe(false);
  });
});

// ---------------------------------------------------------------- //
// Atom predicates
// ---------------------------------------------------------------- //

describe("eventOfKind", () => {
  test("matches when present", () => {
    const events = [turnBegun(1), damage(2), healed(1)];
    const r = evaluate(eventOfKind("damage.applied"), events);
    expect(r.matched).toBe(true);
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0].kind).toBe("damage.applied");
  });
  test("misses when absent", () => {
    const events = [turnBegun(1), healed(1)];
    const r = evaluate(eventOfKind("damage.applied"), events);
    expect(r.matched).toBe(false);
    expect(r.evidence).toEqual([]);
  });
  test("empty slice cannot match", () => {
    const r = evaluate(eventOfKind("damage.applied"), []);
    expect(r.matched).toBe(false);
  });
});

describe("whereEvent", () => {
  test("matches with custom predicate", () => {
    const events = [damage(2), damage(8)];
    const r = evaluate(
      whereEvent((e) => e.kind === "damage.applied" && e.amount > 5),
      events,
    );
    expect(r.matched).toBe(true);
    expect(r.evidence[0]).toEqual(damage(8));
  });
  test("misses if no event satisfies", () => {
    const events = [damage(2), damage(3)];
    const r = evaluate(
      whereEvent((e) => e.kind === "damage.applied" && e.amount > 5),
      events,
    );
    expect(r.matched).toBe(false);
  });
});

// ---------------------------------------------------------------- //
// Boolean combinators
// ---------------------------------------------------------------- //

describe("all", () => {
  test("matches when every child matches; evidence is union", () => {
    const events = [damage(2), healed(1), turnBegun(1)];
    const r = evaluate(
      all([eventOfKind("damage.applied"), eventOfKind("healed")]),
      events,
    );
    expect(r.matched).toBe(true);
    const kinds = r.evidence.map((e) => e.kind).sort();
    expect(kinds).toEqual(["damage.applied", "healed"]);
  });
  test("fails on any missing child; no evidence on failure", () => {
    const events = [damage(2)];
    const r = evaluate(
      all([eventOfKind("damage.applied"), eventOfKind("healed")]),
      events,
    );
    expect(r.matched).toBe(false);
    expect(r.evidence).toEqual([]);
  });
  test("vacuous: empty list matches (true)", () => {
    expect(evaluate(all([]), []).matched).toBe(true);
  });
});

describe("any", () => {
  test("matches when at least one child matches; evidence is winner's only", () => {
    const events = [healed(1)];
    const r = evaluate(
      any([eventOfKind("damage.applied"), eventOfKind("healed")]),
      events,
    );
    expect(r.matched).toBe(true);
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0].kind).toBe("healed");
  });
  test("fails when no child matches", () => {
    const events = [turnBegun(1)];
    const r = evaluate(
      any([eventOfKind("damage.applied"), eventOfKind("healed")]),
      events,
    );
    expect(r.matched).toBe(false);
  });
  test("short-circuits on first match (evidence from first child)", () => {
    const events = [damage(1), healed(1)];
    const r = evaluate(
      any([eventOfKind("damage.applied"), eventOfKind("healed")]),
      events,
    );
    expect(r.matched).toBe(true);
    expect(r.evidence.map((e) => e.kind)).toEqual(["damage.applied"]);
  });
  test("vacuous: empty list does NOT match (false)", () => {
    expect(evaluate(any([]), []).matched).toBe(false);
  });
});

describe("not", () => {
  test("inverts a non-match", () => {
    expect(evaluate(not(eventOfKind("damage.applied")), []).matched).toBe(true);
  });
  test("inverts a match", () => {
    expect(
      evaluate(not(eventOfKind("damage.applied")), [damage(1)]).matched,
    ).toBe(false);
  });
  test("never produces evidence (positive proof of a non-match doesn't exist)", () => {
    const r = evaluate(not(eventOfKind("damage.applied")), []);
    expect(r.matched).toBe(true);
    expect(r.evidence).toEqual([]);
  });
});

describe("TRUE / FALSE constants", () => {
  test("TRUE matches anything", () => {
    expect(evaluate(TRUE, []).matched).toBe(true);
  });
  test("FALSE never matches", () => {
    expect(evaluate(FALSE, [damage(1)]).matched).toBe(false);
  });
});

// ---------------------------------------------------------------- //
// count
// ---------------------------------------------------------------- //

describe("count", () => {
  test(">= N matches when threshold reached", () => {
    const events = [damage(1), damage(2), damage(3), healed(1)];
    const r = evaluate(count(eventOfKind("damage.applied"), ">= 3"), events);
    expect(r.matched).toBe(true);
    // Evidence: the first 3 matching events.
    expect(r.evidence).toHaveLength(3);
    expect(r.evidence.every((e) => e.kind === "damage.applied")).toBe(true);
  });
  test(">= N misses when below threshold", () => {
    const events = [damage(1), damage(2)];
    const r = evaluate(count(eventOfKind("damage.applied"), ">= 3"), events);
    expect(r.matched).toBe(false);
  });
  test("== N strict match", () => {
    const events = [damage(1), damage(2)];
    expect(
      evaluate(count(eventOfKind("damage.applied"), "== 2"), events).matched,
    ).toBe(true);
    expect(
      evaluate(count(eventOfKind("damage.applied"), "== 3"), events).matched,
    ).toBe(false);
  });
  test("< N misses when at threshold", () => {
    expect(
      evaluate(
        count(eventOfKind("damage.applied"), "< 2"),
        [damage(1), damage(2)],
      ).matched,
    ).toBe(false);
  });
  test("count over a custom whereEvent", () => {
    const events = [damage(1), damage(8), damage(9)];
    const r = evaluate(
      count(
        whereEvent((e) => e.kind === "damage.applied" && e.amount > 5),
        ">= 2",
      ),
      events,
    );
    expect(r.matched).toBe(true);
  });
});

// ---------------------------------------------------------------- //
// havingTool
// ---------------------------------------------------------------- //

describe("havingTool", () => {
  test("apply_damage maps to damage.applied", () => {
    expect(evaluate(havingTool("apply_damage"), [damage(1)]).matched).toBe(true);
    expect(evaluate(havingTool("apply_damage"), [healed(1)]).matched).toBe(false);
  });
  test("heal maps to healed", () => {
    expect(evaluate(havingTool("heal"), [healed(1)]).matched).toBe(true);
  });
  test("absorb maps to absorbed", () => {
    expect(
      evaluate(havingTool("absorb"), [
        { kind: "absorbed", itemId: "x", into: "y" },
      ]).matched,
    ).toBe(true);
  });
  test("narrate_only never matches (no event)", () => {
    expect(evaluate(havingTool("narrate_only"), [damage(1)]).matched).toBe(false);
  });
});

// ---------------------------------------------------------------- //
// inOrder
// ---------------------------------------------------------------- //

describe("inOrder", () => {
  test("matches when slots line up left-to-right", () => {
    // "harm THEN help": negative relationship.updated → positive one.
    const events = [
      relationship("kethra", -1),
      turnBegun(1),
      relationship("kethra", +2),
    ];
    const r = evaluate(
      inOrder([
        whereEvent((e) => e.kind === "relationship.updated" && e.delta < 0),
        whereEvent((e) => e.kind === "relationship.updated" && e.delta > 0),
      ]),
      events,
    );
    expect(r.matched).toBe(true);
    expect(r.evidence).toHaveLength(2);
  });
  test("fails when slots are out of order", () => {
    const events = [
      relationship("kethra", +1),
      relationship("kethra", -1),
    ];
    const r = evaluate(
      inOrder([
        whereEvent((e) => e.kind === "relationship.updated" && e.delta < 0),
        whereEvent((e) => e.kind === "relationship.updated" && e.delta > 0),
      ]),
      events,
    );
    expect(r.matched).toBe(false);
  });
  test("empty slot list is vacuously true", () => {
    expect(evaluate(inOrder([]), []).matched).toBe(true);
  });
  test("greedy: takes the first match for each slot", () => {
    const events = [damage(1), damage(2), damage(3), healed(1)];
    const r = evaluate(
      inOrder([eventOfKind("damage.applied"), eventOfKind("healed")]),
      events,
    );
    expect(r.matched).toBe(true);
  });
});

// ---------------------------------------------------------------- //
// withinTurns
// ---------------------------------------------------------------- //

describe("withinTurns", () => {
  test("restricts to last N turns when more turns exist", () => {
    // Turns 1, 2, 3. Damage in turn 1 only. withinTurns(p, 1) only
    // sees turn 3 → no match.
    const events: Event[] = [
      turnBegun(1),
      damage(5),
      turnBegun(2),
      turnBegun(3),
    ];
    const r = evaluate(
      withinTurns(eventOfKind("damage.applied"), 1),
      events,
    );
    expect(r.matched).toBe(false);
  });
  test("returns full slice if fewer turns than N", () => {
    const events: Event[] = [turnBegun(1), damage(5)];
    expect(
      evaluate(withinTurns(eventOfKind("damage.applied"), 5), events).matched,
    ).toBe(true);
  });
  test("N=0 is degenerate and never matches", () => {
    expect(
      evaluate(withinTurns(TRUE, 0), [damage(1)]).matched,
    ).toBe(false);
  });
  test("matches when the event is in the recent window", () => {
    // Damage in turn 3; window of last 2 turns includes turn 2 and 3.
    const events: Event[] = [
      turnBegun(1),
      turnBegun(2),
      turnBegun(3),
      damage(5),
    ];
    expect(
      evaluate(withinTurns(eventOfKind("damage.applied"), 2), events).matched,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------- //
// Composition tests — realistic achievement-style predicates
// ---------------------------------------------------------------- //

describe("composition", () => {
  test('"first death" — session.ended with reason=death', () => {
    const events: Event[] = [
      turnBegun(1),
      damage(99),
      ended("death"),
    ];
    const r = evaluate(
      whereEvent((e) => e.kind === "session.ended" && e.reason === "death"),
      events,
    );
    expect(r.matched).toBe(true);
  });

  test('"reformed" — harm an NPC, then later help them, in any order of other events', () => {
    const events: Event[] = [
      turnBegun(1),
      relationship("kethra", -1),
      damage(2),
      turnBegun(2),
      healed(1),
      relationship("kethra", +2),
      ended("win"),
    ];
    const reformed = inOrder([
      whereEvent((e) => e.kind === "relationship.updated" && e.delta < 0),
      whereEvent((e) => e.kind === "relationship.updated" && e.delta > 0),
    ]);
    const r = evaluate(reformed, events);
    expect(r.matched).toBe(true);
    expect(r.evidence).toHaveLength(2);
  });

  test('"survived 10 turns cursed" — count of turn.begun within a window where bad_luck > 0', () => {
    // Surrogate: 10 turn.begun events with at least one form_state
    // change adding bad_luck.
    const events: Event[] = [];
    for (let t = 1; t <= 10; t++) events.push(turnBegun(t));
    events.push({ kind: "form_state.changed", field: "bad_luck", delta: 2 });
    const cursed = all([
      count(eventOfKind("turn.begun"), ">= 10"),
      whereEvent(
        (e) => e.kind === "form_state.changed" && e.field === "bad_luck" && e.delta > 0,
      ),
    ]);
    expect(evaluate(cursed, events).matched).toBe(true);
  });

  test('"clean fighter" — damage dealt, no curses received', () => {
    const events: Event[] = [damage(2)];
    const clean = all([
      eventOfKind("damage.applied"),
      not(
        whereEvent(
          (e) => e.kind === "form_state.changed" && e.field === "bad_luck" && e.delta > 0,
        ),
      ),
    ]);
    expect(evaluate(clean, events).matched).toBe(true);
  });
});
