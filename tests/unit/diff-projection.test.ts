/**
 * diffProjection — pure helper that the play page uses to render
 * per-turn state-change toasts (vital deltas, inventory adds/removes,
 * newly-discovered rooms).
 */
import {
  diffProjection,
  EMPTY_DIFF,
} from "@/lib/game/diff-projection";
import type { Projection } from "@/lib/game/types";

function makeProj(overrides?: Partial<Projection>): Projection {
  return {
    sessionId: "s1",
    upToSeq: 0,
    form: {
      id: "test",
      vitals: { hp: 10, mana: 5 },
      vitalsMax: { hp: 10, mana: 5 },
      vitalsDeath: { hp: 0, mana: null },
      stats: {},
      state: {},
    },
    npcs: {},
    turn: 0,
    xp: 0,
    quest: { id: null, objectives: {} },
    status: "active",
    location: { id: "loc-a", roomId: "r-1", discovered: ["r-1"] },
    inventory: [],
    reincarnatedAs: null,
    ...overrides,
  };
}

describe("diffProjection", () => {
  test("null prev returns the empty sentinel", () => {
    expect(diffProjection(null, makeProj())).toEqual(EMPTY_DIFF);
    expect(diffProjection(null, makeProj()).hasChange).toBe(false);
  });

  test("identical projections produce no change", () => {
    const p = makeProj();
    const diff = diffProjection(p, p);
    expect(diff.hasChange).toBe(false);
    expect(diff.vitals).toHaveLength(0);
  });

  test("vital decreases produce a negative delta entry", () => {
    const prev = makeProj();
    const next = makeProj({
      form: { ...prev.form, vitals: { hp: 10, mana: 1 } },
    });
    const diff = diffProjection(prev, next);
    expect(diff.hasChange).toBe(true);
    expect(diff.vitals).toEqual([
      { name: "mana", prev: 5, next: 1, delta: -4 },
    ]);
  });

  test("vital increases produce a positive delta entry", () => {
    const prev = makeProj();
    const next = makeProj({
      form: { ...prev.form, vitals: { hp: 10, mana: 8 } },
    });
    const diff = diffProjection(prev, next);
    expect(diff.vitals[0]?.delta).toBe(3);
  });

  test("multiple vital changes are all reported", () => {
    const prev = makeProj();
    const next = makeProj({
      form: { ...prev.form, vitals: { hp: 7, mana: 2 } },
    });
    const diff = diffProjection(prev, next);
    expect(diff.vitals).toHaveLength(2);
    expect(
      diff.vitals.find((v) => v.name === "hp")?.delta,
    ).toBe(-3);
    expect(
      diff.vitals.find((v) => v.name === "mana")?.delta,
    ).toBe(-3);
  });

  test("inventory add reports the item", () => {
    const prev = makeProj();
    const next = makeProj({
      inventory: [{ itemId: "fish", qty: 1 }],
    });
    const diff = diffProjection(prev, next);
    expect(diff.inventoryAdded).toEqual([{ itemId: "fish", qty: 1 }]);
    expect(diff.inventoryRemoved).toEqual([]);
  });

  test("inventory remove reports the item", () => {
    const prev = makeProj({
      inventory: [{ itemId: "fish", qty: 2 }],
    });
    const next = makeProj({
      inventory: [{ itemId: "fish", qty: 1 }],
    });
    const diff = diffProjection(prev, next);
    expect(diff.inventoryRemoved).toEqual([{ itemId: "fish", qty: 1 }]);
    expect(diff.inventoryAdded).toEqual([]);
  });

  test("newly-discovered room is reported", () => {
    const prev = makeProj();
    const next = makeProj({
      location: { id: "loc-a", roomId: "r-2", discovered: ["r-1", "r-2"] },
    });
    const diff = diffProjection(prev, next);
    expect(diff.roomsDiscovered).toEqual(["r-2"]);
    expect(diff.hasChange).toBe(true);
  });

  test("statusChanged is true when status flips", () => {
    const prev = makeProj({ status: "active" });
    const next = makeProj({ status: "won" });
    const diff = diffProjection(prev, next);
    expect(diff.statusChanged).toBe(true);
  });

  test("hasChange ignores statusChanged so the recap can take over", () => {
    const prev = makeProj({ status: "active" });
    const next = makeProj({ status: "won" });
    const diff = diffProjection(prev, next);
    // status flipping by itself isn't a "diff toast" trigger
    expect(diff.hasChange).toBe(false);
  });
});
