/**
 * previewContribution — running wyrm tally for an in-progress
 * session. The play page surfaces this as "+N feed / -N starve"
 * in the meta-arc strip.
 */
import { previewContribution } from "@/lib/meta/long-wyrm";
import type { Event } from "@/lib/game/types";

function absorbed(): Event {
  return {
    kind: "absorbed",
    itemId: "fish",
    into: "essence",
  };
}

function healed(): Event {
  return {
    kind: "healed",
    target: "$SELF",
    amount: 1,
  };
}

function formStateChanged(field: string, delta: number): Event {
  return {
    kind: "form_state.changed",
    field,
    delta,
  };
}

describe("previewContribution", () => {
  test("empty events return delta 0 + neutral prose", () => {
    const result = previewContribution([]);
    expect(result.delta).toBe(0);
    expect(result.prose).toMatch(/no contribution/);
  });

  test("3 absorbs → +1 feed", () => {
    const result = previewContribution([
      absorbed(),
      absorbed(),
      absorbed(),
    ]);
    expect(result.delta).toBe(1);
    expect(result.prose).toMatch(/feeding/i);
  });

  test("2 absorbs → 0 (under threshold)", () => {
    const result = previewContribution([absorbed(), absorbed()]);
    expect(result.delta).toBe(0);
  });

  test("2 heals → -1 starve", () => {
    const result = previewContribution([healed(), healed()]);
    expect(result.delta).toBe(-1);
    expect(result.prose).toMatch(/starving/i);
  });

  test("wyrm_marked +1 contributes 1 feed", () => {
    const result = previewContribution([formStateChanged("wyrm_marked", 1)]);
    expect(result.delta).toBe(1);
  });

  test("wyrm_attuned +1 contributes 1 starve", () => {
    const result = previewContribution([
      formStateChanged("wyrm_attuned", 1),
    ]);
    expect(result.delta).toBe(-1);
  });

  test("multiple signals stack on the same side", () => {
    const result = previewContribution([
      absorbed(),
      absorbed(),
      absorbed(),
      formStateChanged("wyrm_marked", 1),
      formStateChanged("wyrm_marked", 1),
    ]);
    // 3 absorbs → +1, 2 wyrm_marked hits → +2
    expect(result.delta).toBe(3);
  });

  test("opposing signals cancel", () => {
    const result = previewContribution([
      absorbed(),
      absorbed(),
      absorbed(),
      healed(),
      healed(),
    ]);
    // +1 absorb-heavy, -1 heal-heavy
    expect(result.delta).toBe(0);
  });

  test("form_state.changed with delta 0 doesn't count", () => {
    const result = previewContribution([
      formStateChanged("wyrm_marked", 0),
    ]);
    expect(result.delta).toBe(0);
  });

  test("session.ended events don't add the outcome bonus", () => {
    // The full planContribution would add +5 for death; preview
    // intentionally excludes it.
    const result = previewContribution([
      { kind: "session.ended", reason: "death" },
    ]);
    expect(result.delta).toBe(0);
  });
});
