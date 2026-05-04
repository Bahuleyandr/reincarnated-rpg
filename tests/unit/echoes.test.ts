import {
  effectiveMemorySummary,
  pickEchoPlant,
} from "@/lib/memory/echoes";
import type { Event } from "@/lib/game/types";

describe("pickEchoPlant", () => {
  test("npc.introduced plants a face-echo with 3-turn delay", () => {
    const events: Event[] = [
      {
        kind: "npc.introduced",
        npcId: "n1",
        data: { name: "Kethra" },
      },
    ];
    const result = pickEchoPlant(events);
    expect(result).not.toBeNull();
    expect(result!.plan.surfaceInTurns).toBe(3);
    expect(result!.plan.fullSummary).toMatch(/Kethra/);
    expect(result!.plan.hint).toMatch(/face/);
  });

  test("location.discovered plants a passage-echo with 4-turn delay", () => {
    const events: Event[] = [
      { kind: "location.discovered", locationId: "iron-reach" },
    ];
    const result = pickEchoPlant(events);
    expect(result).not.toBeNull();
    expect(result!.plan.surfaceInTurns).toBe(4);
    expect(result!.plan.fullSummary).toMatch(/iron-reach/);
    expect(result!.plan.hint).toMatch(/passage/);
  });

  test("quest.objectiveUpdated to 'open' plants a thread-echo with 2-turn delay", () => {
    const events: Event[] = [
      {
        kind: "quest.objectiveUpdated",
        questId: "q1",
        objective: "find the binder",
        status: "open",
      },
    ];
    const result = pickEchoPlant(events);
    expect(result).not.toBeNull();
    expect(result!.plan.surfaceInTurns).toBe(2);
    expect(result!.plan.fullSummary).toMatch(/binder/);
  });

  test("quest.objectiveUpdated 'done' does NOT plant", () => {
    const events: Event[] = [
      {
        kind: "quest.objectiveUpdated",
        questId: "q1",
        objective: "find the binder",
        status: "done",
      },
    ];
    expect(pickEchoPlant(events)).toBeNull();
  });

  test("first matching event wins (cap one echo per turn)", () => {
    const events: Event[] = [
      { kind: "location.discovered", locationId: "iron-reach" },
      {
        kind: "npc.introduced",
        npcId: "n1",
        data: { name: "Kethra" },
      },
    ];
    const result = pickEchoPlant(events);
    expect(result).not.toBeNull();
    expect(result!.source.kind).toBe("location.discovered");
  });

  test("non-trigger events return null", () => {
    const events: Event[] = [
      { kind: "turn.begun", turn: 1, input: "x", inputSanitized: "x" },
      { kind: "moved", fromRoom: "a", toRoom: "b" },
    ];
    expect(pickEchoPlant(events)).toBeNull();
  });

  test("empty event list returns null", () => {
    expect(pickEchoPlant([])).toBeNull();
  });
});

describe("effectiveMemorySummary", () => {
  test("non-echo memory returns its full summary", () => {
    expect(
      effectiveMemorySummary(
        {
          summary: "you killed the rat",
          surfaceAfterTurn: null,
          echoHint: null,
        },
        5,
      ),
    ).toBe("you killed the rat");
  });

  test("echo before surfaceAfterTurn returns the hint", () => {
    expect(
      effectiveMemorySummary(
        {
          summary: "Kethra entered your awareness",
          surfaceAfterTurn: 5,
          echoHint: "you remember a face you have not yet learned",
        },
        3,
      ),
    ).toMatch(/face you have not yet learned/);
  });

  test("echo after surfaceAfterTurn returns the full summary", () => {
    expect(
      effectiveMemorySummary(
        {
          summary: "Kethra entered your awareness",
          surfaceAfterTurn: 5,
          echoHint: "you remember a face you have not yet learned",
        },
        7,
      ),
    ).toBe("Kethra entered your awareness");
  });

  test("echo at exactly surfaceAfterTurn matures (>=)", () => {
    expect(
      effectiveMemorySummary(
        {
          summary: "Kethra entered your awareness",
          surfaceAfterTurn: 5,
          echoHint: "hint",
        },
        5,
      ),
    ).toBe("Kethra entered your awareness");
  });

  test("echo without echoHint falls back to summary (defensive)", () => {
    expect(
      effectiveMemorySummary(
        {
          summary: "fallback",
          surfaceAfterTurn: 5,
          echoHint: null,
        },
        2,
      ),
    ).toBe("fallback");
  });
});
