/**
 * Objectives — period-key math + catalog integrity + predicate
 * matching. Persistence (DB tick + claim flow) is exercised in
 * tests/integration/objectives.test.ts (skipped here since the
 * runner is the path with the most surface).
 */
import {
  getObjective,
  listDaily,
  listObjectives,
  listWeekly,
} from "@/lib/objectives/catalog";
import { dailyKey, periodKeyFor, weeklyKey } from "@/lib/objectives/period";
import { evaluate } from "@/lib/predicates/runner";
import type { Event } from "@/lib/game/types";

// ---------------------------------------------------------------- //
// Period keys
// ---------------------------------------------------------------- //

describe("dailyKey", () => {
  test("formats UTC midnight", () => {
    expect(dailyKey(new Date("2026-05-04T00:00:00Z"))).toBe("2026-05-04");
  });
  test("formats end of day", () => {
    expect(dailyKey(new Date("2026-05-04T23:59:59Z"))).toBe("2026-05-04");
  });
  test("rolls over at UTC midnight", () => {
    expect(dailyKey(new Date("2026-05-05T00:00:00Z"))).toBe("2026-05-05");
  });
  test("zero-pads month and day", () => {
    expect(dailyKey(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});

describe("weeklyKey (ISO 8601)", () => {
  test("a Monday is in the week's first day", () => {
    // 2026-05-04 is a Monday — ISO week 19.
    expect(weeklyKey(new Date("2026-05-04T12:00:00Z"))).toBe("2026-W19");
  });
  test("a Sunday is the last day of the same week", () => {
    // 2026-05-10 is the Sunday of week 19.
    expect(weeklyKey(new Date("2026-05-10T12:00:00Z"))).toBe("2026-W19");
  });
  test("a Monday rolls into the next week", () => {
    // 2026-05-11 is the Monday of week 20.
    expect(weeklyKey(new Date("2026-05-11T00:00:00Z"))).toBe("2026-W20");
  });
  test("year-spanning week (Jan 1 may belong to prior year's last week)", () => {
    // 2026-01-01 is a Thursday → ISO week 1 of 2026.
    expect(weeklyKey(new Date("2026-01-01T12:00:00Z"))).toBe("2026-W01");
    // 2025-01-01 is a Wednesday → ISO week 1 of 2025.
    expect(weeklyKey(new Date("2025-01-01T12:00:00Z"))).toBe("2025-W01");
  });
});

describe("periodKeyFor", () => {
  test("daily routes through dailyKey", () => {
    expect(periodKeyFor("daily", new Date("2026-05-04T12:00:00Z"))).toBe("2026-05-04");
  });
  test("weekly routes through weeklyKey", () => {
    expect(periodKeyFor("weekly", new Date("2026-05-04T12:00:00Z"))).toBe("2026-W19");
  });
});

// ---------------------------------------------------------------- //
// Catalog integrity
// ---------------------------------------------------------------- //

describe("objective catalog", () => {
  test("loads at least 10 entries", () => {
    expect(listObjectives().length).toBeGreaterThanOrEqual(10);
  });
  test("ids are unique", () => {
    const ids = new Set(listObjectives().map((o) => o.id));
    expect(ids.size).toBe(listObjectives().length);
  });
  test("daily + weekly partition equals total", () => {
    expect(listDaily().length + listWeekly().length).toBe(listObjectives().length);
  });
  test("every entry has a positive integer target", () => {
    for (const o of listObjectives()) {
      expect(Number.isInteger(o.target)).toBe(true);
      expect(o.target).toBeGreaterThan(0);
    }
  });
  test("every entry's predicate is callable on []", () => {
    for (const o of listObjectives()) {
      expect(() => o.predicate([])).not.toThrow();
    }
  });
  test("every entry has an energy reward with positive amount", () => {
    for (const o of listObjectives()) {
      expect(o.reward.kind).toBe("energy");
      expect(o.reward.amount).toBeGreaterThan(0);
    }
  });
  test("getObjective returns a known entry + null for unknown", () => {
    expect(getObjective("daily-three-turns")).not.toBeNull();
    expect(getObjective("no-such")).toBeNull();
  });
});

// ---------------------------------------------------------------- //
// Predicate matching for representative entries
// ---------------------------------------------------------------- //

describe("objective predicates fire correctly", () => {
  test('"daily-three-turns" matches each turn.begun individually', () => {
    const o = getObjective("daily-three-turns")!;
    const events: Event[] = [
      { kind: "turn.begun", turn: 1, input: "x", inputSanitized: "x" },
      { kind: "turn.begun", turn: 2, input: "x", inputSanitized: "x" },
    ];
    // The runner counts per-event matches; here we just verify
    // each matches in isolation.
    let count = 0;
    for (const e of events) {
      if (evaluate(o.predicate, [e]).matched) count += 1;
    }
    expect(count).toBe(2);
  });

  test('"daily-survive-once" matches a win event only', () => {
    const o = getObjective("daily-survive-once")!;
    expect(
      evaluate(o.predicate, [{ kind: "session.ended", reason: "win" }]).matched,
    ).toBe(true);
    expect(
      evaluate(o.predicate, [{ kind: "session.ended", reason: "death" }])
        .matched,
    ).toBe(false);
  });

  test('"daily-good-roll" matches a 10+ roll', () => {
    const o = getObjective("daily-good-roll")!;
    expect(
      evaluate(o.predicate, [
        {
          kind: "roll.resolved",
          roll: { d1: 5, d2: 5, mod: 0, total: 10, band: "success", seed: 0 },
          against: "x",
        },
      ]).matched,
    ).toBe(true);
    expect(
      evaluate(o.predicate, [
        {
          kind: "roll.resolved",
          roll: { d1: 4, d2: 5, mod: 0, total: 9, band: "partial", seed: 0 },
          against: "x",
        },
      ]).matched,
    ).toBe(false);
  });

  test('"weekly-five-runs" matches each session.ended (counts up across the week)', () => {
    const o = getObjective("weekly-five-runs")!;
    const events: Event[] = [
      { kind: "session.ended", reason: "death" },
      { kind: "session.ended", reason: "win" },
      { kind: "session.ended", reason: "cap" },
    ];
    let count = 0;
    for (const e of events) {
      if (evaluate(o.predicate, [e]).matched) count += 1;
    }
    expect(count).toBe(3);
  });
});
