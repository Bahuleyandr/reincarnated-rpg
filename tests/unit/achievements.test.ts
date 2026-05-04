/**
 * Achievements: catalog parsing + DSL parser + cataloged-entry
 * predicate evaluation against synthetic event slices.
 *
 * The catalog file (content/achievements.json) is loaded at module
 * import; if any predicate fails to parse the import itself throws.
 * That's intentional — we want a fail-fast at boot.
 */
import { parsePredicate } from "@/lib/achievements/dsl-parser";
import {
  getAchievement,
  listAchievements,
  listLifetimeAchievements,
  listSessionAchievements,
} from "@/lib/achievements/catalog";
import { evaluate } from "@/lib/predicates/runner";
import type { Event } from "@/lib/game/types";

// ---------------------------------------------------------------- //
// JSON-DSL parser
// ---------------------------------------------------------------- //

describe("parsePredicate — node types", () => {
  test("eventOfKind parses + matches", () => {
    const p = parsePredicate({ type: "eventOfKind", kind: "session.ended" });
    expect(
      evaluate(p, [{ kind: "session.ended", reason: "death" }]).matched,
    ).toBe(true);
  });

  test("eventWith partial-equality", () => {
    const p = parsePredicate({
      type: "eventWith",
      match: { kind: "session.ended", reason: "death" },
    });
    expect(
      evaluate(p, [{ kind: "session.ended", reason: "death" }]).matched,
    ).toBe(true);
    expect(
      evaluate(p, [{ kind: "session.ended", reason: "win" }]).matched,
    ).toBe(false);
  });

  test("eventWith with nested dotted-key path", () => {
    const events: Event[] = [
      {
        kind: "roll.resolved",
        roll: { d1: 6, d2: 6, mod: 0, total: 12, band: "success", seed: 0 },
        against: "x",
      },
    ];
    const p = parsePredicate({
      type: "eventWith",
      match: { kind: "roll.resolved", "roll.total": 12 },
    });
    expect(evaluate(p, events).matched).toBe(true);
  });

  test("eventWith with $gte operator", () => {
    const events: Event[] = [
      { kind: "damage.applied", target: "$SELF", amount: 8, source: "rat" },
    ];
    const p = parsePredicate({
      type: "eventWith",
      match: {
        kind: "damage.applied",
        amount: { $gte: 5 },
      },
    });
    expect(evaluate(p, events).matched).toBe(true);
  });

  test("eventWith with $matches regex operator", () => {
    const events: Event[] = [
      { kind: "damage.applied", target: "$SELF", amount: 1, source: "own-tool-backfire" },
    ];
    const p = parsePredicate({
      type: "eventWith",
      match: {
        kind: "damage.applied",
        source: { $matches: "self|own[-_]tool" },
      },
    });
    expect(evaluate(p, events).matched).toBe(true);
  });

  test("count combinator", () => {
    const events: Event[] = [
      { kind: "damage.applied", target: "$SELF", amount: 1, source: "x" },
      { kind: "damage.applied", target: "$SELF", amount: 2, source: "x" },
      { kind: "damage.applied", target: "$SELF", amount: 3, source: "x" },
    ];
    const p = parsePredicate({
      type: "count",
      filter: { type: "eventOfKind", kind: "damage.applied" },
      spec: ">= 3",
    });
    expect(evaluate(p, events).matched).toBe(true);
  });

  test("all + not composition", () => {
    const events: Event[] = [
      { kind: "turn.begun", turn: 1, input: "x", inputSanitized: "x" },
      { kind: "turn.begun", turn: 2, input: "x", inputSanitized: "x" },
      { kind: "turn.begun", turn: 3, input: "x", inputSanitized: "x" },
    ];
    const p = parsePredicate({
      type: "all",
      children: [
        {
          type: "count",
          filter: { type: "eventOfKind", kind: "turn.begun" },
          spec: ">= 3",
        },
        {
          type: "not",
          child: { type: "eventOfKind", kind: "damage.applied" },
        },
      ],
    });
    expect(evaluate(p, events).matched).toBe(true);
  });

  test("inOrder maps through DSL", () => {
    const events: Event[] = [
      { kind: "relationship.updated", npcId: "k", delta: -1, reason: "x" },
      { kind: "relationship.updated", npcId: "k", delta: +1, reason: "x" },
    ];
    const p = parsePredicate({
      type: "inOrder",
      children: [
        {
          type: "eventWith",
          match: { kind: "relationship.updated", delta: { $lte: -1 } },
        },
        {
          type: "eventWith",
          match: { kind: "relationship.updated", delta: { $gte: 1 } },
        },
      ],
    });
    expect(evaluate(p, events).matched).toBe(true);
  });

  test("true/false constants", () => {
    expect(evaluate(parsePredicate({ type: "true" }), []).matched).toBe(true);
    expect(evaluate(parsePredicate({ type: "false" }), []).matched).toBe(false);
  });

  test("unknown node type throws", () => {
    expect(() => parsePredicate({ type: "no_such_node" })).toThrow(/unknown node type/);
  });

  test("missing type throws", () => {
    expect(() => parsePredicate({})).toThrow();
  });

  test("$in operator", () => {
    const events: Event[] = [
      {
        kind: "quest.objectiveUpdated",
        questId: "q",
        objective: "x",
        status: "done",
      },
    ];
    const p = parsePredicate({
      type: "eventWith",
      match: { kind: "quest.objectiveUpdated", status: { $in: ["done", "failed"] } },
    });
    expect(evaluate(p, events).matched).toBe(true);
  });
});

// ---------------------------------------------------------------- //
// Catalog integrity
// ---------------------------------------------------------------- //

describe("achievement catalog", () => {
  test("loads at least 30 entries", () => {
    expect(listAchievements().length).toBeGreaterThanOrEqual(30);
  });

  test("every entry has a valid scope", () => {
    for (const a of listAchievements()) {
      expect(["session", "lifetime"]).toContain(a.scope);
    }
  });

  test("every entry has a non-empty id, label, description", () => {
    for (const a of listAchievements()) {
      expect(a.id.length).toBeGreaterThan(0);
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(0);
    }
  });

  test("ids are unique", () => {
    const ids = new Set(listAchievements().map((a) => a.id));
    expect(ids.size).toBe(listAchievements().length);
  });

  test("session + lifetime partition equals total", () => {
    const total = listAchievements().length;
    const ss = listSessionAchievements().length;
    const lt = listLifetimeAchievements().length;
    expect(ss + lt).toBe(total);
  });

  test("every entry's predicate is callable", () => {
    for (const a of listAchievements()) {
      expect(typeof a.predicate).toBe("function");
      // Should not throw on an empty event slice.
      expect(() => a.predicate([])).not.toThrow();
    }
  });

  test("getAchievement returns a known entry", () => {
    expect(getAchievement("first-reincarnation")).not.toBeNull();
    expect(getAchievement("no-such-thing")).toBeNull();
  });
});

// ---------------------------------------------------------------- //
// Catalog predicate behaviour — pin a few representative cases
// ---------------------------------------------------------------- //

describe("catalog predicates fire correctly", () => {
  test('"first-reincarnation" matches on a turn.begun event', () => {
    const a = getAchievement("first-reincarnation");
    expect(a).not.toBeNull();
    const events: Event[] = [
      { kind: "turn.begun", turn: 1, input: "x", inputSanitized: "x" },
    ];
    expect(evaluate(a!.predicate, events).matched).toBe(true);
  });

  test('"mortal-reminder" matches on a death event only', () => {
    const a = getAchievement("mortal-reminder")!;
    expect(
      evaluate(a.predicate, [{ kind: "session.ended", reason: "death" }])
        .matched,
    ).toBe(true);
    expect(
      evaluate(a.predicate, [{ kind: "session.ended", reason: "win" }])
        .matched,
    ).toBe(false);
  });

  test('"reformed" matches harm-then-help', () => {
    const a = getAchievement("reformed")!;
    const events: Event[] = [
      { kind: "relationship.updated", npcId: "k", delta: -1, reason: "x" },
      { kind: "relationship.updated", npcId: "k", delta: +1, reason: "x" },
    ];
    expect(evaluate(a.predicate, events).matched).toBe(true);
  });

  test('"lucky-roll" matches on a 12+', () => {
    const a = getAchievement("lucky-roll")!;
    expect(
      evaluate(a.predicate, [
        {
          kind: "roll.resolved",
          roll: { d1: 6, d2: 6, mod: 0, total: 12, band: "success", seed: 0 },
          against: "x",
        },
      ]).matched,
    ).toBe(true);
  });

  test('"the-quiet" matches a session ended with zero damage', () => {
    const a = getAchievement("the-quiet")!;
    expect(
      evaluate(a.predicate, [{ kind: "session.ended", reason: "win" }])
        .matched,
    ).toBe(true);
    // With damage in the slice, fails.
    expect(
      evaluate(a.predicate, [
        { kind: "damage.applied", target: "$SELF", amount: 1, source: "x" },
        { kind: "session.ended", reason: "win" },
      ]).matched,
    ).toBe(false);
  });

  test('"thrice-died" needs 3 death events to fire', () => {
    const a = getAchievement("thrice-died")!;
    const ended = (r: "death" | "win" | "cap") => ({
      kind: "session.ended" as const,
      reason: r,
    });
    expect(evaluate(a.predicate, [ended("death"), ended("death")]).matched).toBe(false);
    expect(
      evaluate(a.predicate, [ended("death"), ended("death"), ended("death")])
        .matched,
    ).toBe(true);
    // Wins don't count.
    expect(
      evaluate(a.predicate, [ended("win"), ended("win"), ended("win")])
        .matched,
    ).toBe(false);
  });
});
