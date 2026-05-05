/**
 * resolveFirstGoal — pure goal-completion check used by /api/state
 * and the /play page to render the goal ribbon.
 */
import { resolveFirstGoal } from "@/lib/game/goals";
import type { FormTemplate, Projection } from "@/lib/game/types";

function makeForm(
  firstGoal?: FormTemplate["firstGoal"],
): FormTemplate {
  return {
    id: "test-form",
    vitals: { hp: { max: 10, start: 10, death: 0 } },
    stats: {},
    verbs: ["wait"],
    firstGoal,
  };
}

function makeProjection(overrides?: Partial<Projection>): Projection {
  return {
    sessionId: "s1",
    upToSeq: 0,
    form: {
      id: "test-form",
      vitals: { hp: 10 },
      vitalsMax: { hp: 10 },
      vitalsDeath: { hp: 0 },
      stats: {},
      state: {},
    },
    npcs: {},
    turn: 0,
    quest: { id: null, objectives: {} },
    status: "active",
    location: { id: "loc-a", roomId: "r-1", discovered: ["r-1"] },
    inventory: [],
    reincarnatedAs: null,
    ...overrides,
  };
}

describe("resolveFirstGoal", () => {
  test("returns null when the form has no firstGoal", () => {
    const form = makeForm(undefined);
    const proj = makeProjection({ turn: 5 });
    expect(resolveFirstGoal(form, proj)).toBeNull();
  });

  test("turn_min: increments with projection.turn and completes at target", () => {
    const form = makeForm({
      id: "g1",
      label: "act 3 times",
      description: "...",
      completion: { kind: "turn_min", target: 3 },
    });
    expect(resolveFirstGoal(form, makeProjection({ turn: 0 }))?.completed).toBe(
      false,
    );
    expect(resolveFirstGoal(form, makeProjection({ turn: 0 }))?.current).toBe(0);
    expect(resolveFirstGoal(form, makeProjection({ turn: 2 }))?.completed).toBe(
      false,
    );
    expect(resolveFirstGoal(form, makeProjection({ turn: 2 }))?.current).toBe(2);
    expect(resolveFirstGoal(form, makeProjection({ turn: 3 }))?.completed).toBe(
      true,
    );
    expect(resolveFirstGoal(form, makeProjection({ turn: 100 }))?.current).toBe(
      3,
    );
  });

  test("rooms_visited: counts entries in projection.location.discovered", () => {
    const form = makeForm({
      id: "g2",
      label: "explore",
      description: "...",
      completion: { kind: "rooms_visited", target: 2 },
    });
    expect(
      resolveFirstGoal(
        form,
        makeProjection({
          location: { id: "x", roomId: "r1", discovered: ["r1"] },
        }),
      )?.completed,
    ).toBe(false);
    expect(
      resolveFirstGoal(
        form,
        makeProjection({
          location: { id: "x", roomId: "r1", discovered: ["r1", "r2"] },
        }),
      )?.completed,
    ).toBe(true);
  });

  test("form_state: reads projection.form.state[field]", () => {
    const form = makeForm({
      id: "g3",
      label: "claim domain",
      description: "...",
      completion: {
        kind: "form_state",
        field: "domain_size",
        target: 3,
      },
    });
    const baseProj = makeProjection();
    expect(
      resolveFirstGoal(form, {
        ...baseProj,
        form: { ...baseProj.form, state: { domain_size: 1 } },
      })?.current,
    ).toBe(1);
    expect(
      resolveFirstGoal(form, {
        ...baseProj,
        form: { ...baseProj.form, state: { domain_size: 5 } },
      })?.completed,
    ).toBe(true);
    // Missing field counts as 0.
    expect(
      resolveFirstGoal(form, {
        ...baseProj,
        form: { ...baseProj.form, state: {} },
      })?.current,
    ).toBe(0);
  });

  test("vital_min: reads projection.form.vitals[field]", () => {
    const form = makeForm({
      id: "g4",
      label: "stay alive",
      description: "...",
      completion: { kind: "vital_min", field: "hp", target: 5 },
    });
    const baseProj = makeProjection();
    expect(
      resolveFirstGoal(form, {
        ...baseProj,
        form: { ...baseProj.form, vitals: { hp: 3 } },
      })?.completed,
    ).toBe(false);
    expect(
      resolveFirstGoal(form, {
        ...baseProj,
        form: { ...baseProj.form, vitals: { hp: 10 } },
      })?.completed,
    ).toBe(true);
  });

  test("current is clamped to target so progress bars never overflow", () => {
    const form = makeForm({
      id: "g5",
      label: "wait",
      description: "...",
      completion: { kind: "turn_min", target: 3 },
    });
    const goal = resolveFirstGoal(form, makeProjection({ turn: 100 }));
    expect(goal?.current).toBe(3);
    expect(goal?.target).toBe(3);
    expect(goal?.completed).toBe(true);
  });
});
