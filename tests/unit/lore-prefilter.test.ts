/**
 * Lore pre-filter — the cheap heuristic that rejects most runs
 * without an LLM call.
 */
import { lorePreFilter } from "@/lib/lore/judge";
import type { Event } from "@/lib/game/types";

const baseEvents: Event[] = [
  { kind: "session.started", formId: "lesser-slime", seed: 1 },
];

describe("lorePreFilter", () => {
  test("rejects sub-3-turn runs", () => {
    expect(
      lorePreFilter(baseEvents, {
        turn: 2,
        outcome: "death",
        beatsFired: 0,
      }),
    ).toBe(false);
  });

  test("rejects cap-without-progress (afk)", () => {
    expect(
      lorePreFilter(baseEvents, {
        turn: 10,
        outcome: "cap",
        beatsFired: 0,
      }),
    ).toBe(false);
  });

  test("accepts win outcomes", () => {
    expect(
      lorePreFilter(baseEvents, {
        turn: 7,
        outcome: "win",
        beatsFired: 0,
      }),
    ).toBe(true);
  });

  test("accepts runs with beats fired", () => {
    expect(
      lorePreFilter(baseEvents, {
        turn: 6,
        outcome: "death",
        beatsFired: 2,
      }),
    ).toBe(true);
  });

  test("accepts runs with quest completions", () => {
    const events: Event[] = [
      ...baseEvents,
      {
        kind: "quest.objectiveUpdated",
        questId: "x",
        objective: "save-the-village",
        status: "done",
      },
    ];
    expect(
      lorePreFilter(events, { turn: 5, outcome: "death", beatsFired: 0 }),
    ).toBe(true);
  });

  test("accepts runs with wyrm_marked >= 2 cumulative", () => {
    const events: Event[] = [
      ...baseEvents,
      { kind: "form_state.changed", field: "wyrm_marked", delta: 1 },
      { kind: "form_state.changed", field: "wyrm_marked", delta: 1 },
    ];
    expect(
      lorePreFilter(events, { turn: 5, outcome: "death", beatsFired: 0 }),
    ).toBe(true);
  });

  test("accepts substantive runs (>=8 turns, not capped)", () => {
    expect(
      lorePreFilter(baseEvents, {
        turn: 9,
        outcome: "death",
        beatsFired: 0,
      }),
    ).toBe(true);
  });

  test("rejects substantive cap runs (lurker)", () => {
    expect(
      lorePreFilter(baseEvents, {
        turn: 10,
        outcome: "cap",
        beatsFired: 0,
      }),
    ).toBe(false);
  });
});
