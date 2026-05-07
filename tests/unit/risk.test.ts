import { rollForLatestTurn } from "@/lib/game/current-turn-roll";
import { loadForm } from "@/lib/game/content";
import { classifyTurnRisk } from "@/lib/game/risk";
import type { Event, RollResult } from "@/lib/game/types";

describe("turn risk classification", () => {
  test("ordinary movement and sensing do not roll", () => {
    const form = loadForm("lesser-slime");

    expect(
      classifyTurnRisk({
        input: "I ooze toward the wet stone",
        intent: "ooze",
        form,
      }).level,
    ).toBe("safe");

    expect(
      classifyTurnRisk({
        input: "sense the room",
        intent: "sense_tremor",
        form,
      }).level,
    ).toBe("safe");
  });

  test("dangerous verbs and forceful wording roll", () => {
    const slime = loadForm("lesser-slime");
    const generic = loadForm("generic-creature");

    expect(
      classifyTurnRisk({
        input: "smother the predator",
        intent: "smother",
        form: slime,
      }),
    ).toMatchObject({ level: "risky", reason: "verb:smother" });

    expect(
      classifyTurnRisk({
        input: "I force the door open and attack whatever waits",
        intent: "act",
        form: generic,
      }).level,
    ).toBe("risky");
  });

  test("typed forms keep gentle verbs safe and signature danger risky", () => {
    const book = loadForm("cursed-book");
    const core = loadForm("dungeon-core");

    expect(
      classifyTurnRisk({
        input: "decode the passage slowly",
        intent: "decode_passage",
        form: book,
      }).level,
    ).toBe("safe");

    expect(
      classifyTurnRisk({
        input: "send a wyrm signal through the stone",
        intent: "wyrm_signal",
        form: core,
      }).level,
    ).toBe("risky");
  });

  test("roll overrides always force dice for deterministic evals", () => {
    const form = loadForm("lesser-slime");
    expect(
      classifyTurnRisk({
        input: "sense the room",
        intent: "sense_tremor",
        form,
        hasRollOverride: true,
      }),
    ).toMatchObject({ level: "risky", reason: "roll_override" });
  });
});

describe("current-turn roll extraction", () => {
  const roll: RollResult = {
    d1: 6,
    d2: 4,
    mod: 0,
    total: 10,
    band: "success",
    seed: 123,
    variant: "2d6",
  };

  test("does not leak a previous risky roll into a later safe turn", () => {
    const events: Event[] = [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "turn.begun", turn: 1, input: "attack", inputSanitized: "attack" },
      { kind: "roll.resolved", roll, against: "density" },
      { kind: "narration.emitted", text: "risk happened", toolCallsApplied: 0 },
      { kind: "turn.begun", turn: 2, input: "sense", inputSanitized: "sense" },
      { kind: "intent.classified", verb: "sense_tremor", confidence: 0.7 },
      { kind: "narration.emitted", text: "safe happened", toolCallsApplied: 0 },
    ];

    expect(rollForLatestTurn(events)).toBeNull();
  });

  test("returns the roll when the latest turn is risky", () => {
    const events: Event[] = [
      { kind: "session.started", formId: "lesser-slime", seed: 1 },
      { kind: "turn.begun", turn: 1, input: "sense", inputSanitized: "sense" },
      { kind: "narration.emitted", text: "safe happened", toolCallsApplied: 0 },
      { kind: "turn.begun", turn: 2, input: "smother", inputSanitized: "smother" },
      { kind: "roll.resolved", roll, against: "density" },
      { kind: "narration.emitted", text: "risk happened", toolCallsApplied: 0 },
    ];

    expect(rollForLatestTurn(events)).toBe(roll);
  });
});
