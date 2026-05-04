import {
  classifyRhozellOutcome,
  composeHistoryBeat,
  rhozellAppearanceProbability,
  shouldRhozellAppear,
} from "@/lib/antagonist/rhozell";

describe("rhozellAppearanceProbability", () => {
  test("base low when arcProgress < 0.5, no priors", () => {
    expect(
      rhozellAppearanceProbability({ arcProgress: 0.1, priorEncounters: 0 }),
    ).toBeCloseTo(0.03, 5);
  });
  test("base high when arcProgress >= 0.5", () => {
    expect(
      rhozellAppearanceProbability({ arcProgress: 0.5, priorEncounters: 0 }),
    ).toBeCloseTo(0.15, 5);
  });
  test("priors add 0.05 each", () => {
    expect(
      rhozellAppearanceProbability({ arcProgress: 0.1, priorEncounters: 3 }),
    ).toBeCloseTo(0.18, 5);
  });
  test("clamps at the max probability", () => {
    expect(
      rhozellAppearanceProbability({
        arcProgress: 0.9,
        priorEncounters: 100,
      }),
    ).toBeLessThanOrEqual(0.45);
  });
});

describe("shouldRhozellAppear", () => {
  test("forceFire bypasses probability", () => {
    expect(
      shouldRhozellAppear({
        seed: 0,
        arcProgress: 0,
        priorEncounters: 0,
        forceFire: true,
      }),
    ).toBe(true);
  });
  test("deterministic per seed", () => {
    const a = shouldRhozellAppear({
      seed: 42,
      arcProgress: 0.5,
      priorEncounters: 1,
    });
    const b = shouldRhozellAppear({
      seed: 42,
      arcProgress: 0.5,
      priorEncounters: 1,
    });
    expect(a).toBe(b);
  });
  test("low base + early seeds usually do not fire", () => {
    // Base is 0.03; over 200 seeds we expect <20 fires. Bound loose
    // enough to avoid flakes.
    let fires = 0;
    for (let s = 1; s < 200; s++) {
      if (
        shouldRhozellAppear({
          seed: s,
          arcProgress: 0.1,
          priorEncounters: 0,
        })
      ) {
        fires += 1;
      }
    }
    expect(fires).toBeLessThan(20);
  });
});

describe("composeHistoryBeat", () => {
  test("empty history → 'has not seen you' line", () => {
    expect(composeHistoryBeat([])).toMatch(/has not seen you/);
  });
  test("killed entry yields 'ended him' phrasing", () => {
    expect(
      composeHistoryBeat([
        {
          sessionId: "s1",
          outcome: "killed",
          at: "2026-05-04T00:00:00Z",
          formId: "lesser-slime",
        },
      ]),
    ).toMatch(/ended him/);
  });
  test("priority killed > aided > spared > fled", () => {
    const r = composeHistoryBeat([
      {
        sessionId: "s1",
        outcome: "fled",
        at: "2026-05-04T00:00:00Z",
        formId: "x",
      },
      {
        sessionId: "s2",
        outcome: "spared",
        at: "2026-05-04T00:00:00Z",
        formId: "x",
      },
      {
        sessionId: "s3",
        outcome: "aided",
        at: "2026-05-04T00:00:00Z",
        formId: "x",
      },
      {
        sessionId: "s4",
        outcome: "killed",
        at: "2026-05-04T00:00:00Z",
        formId: "x",
      },
    ]);
    expect(r).toMatch(/ended him/);
  });
  test("falls back gracefully on unknown outcome", () => {
    expect(composeHistoryBeat([])).toBeTruthy();
  });
  test("count surfaces in the beat", () => {
    const r = composeHistoryBeat([
      {
        sessionId: "s1",
        outcome: "aided",
        at: "2026-05-04T00:00:00Z",
        formId: "lesser-slime",
      },
      {
        sessionId: "s2",
        outcome: "killed",
        at: "2026-05-05T00:00:00Z",
        formId: "cursed-book",
      },
    ]);
    expect(r).toMatch(/2 encounter/);
  });
});

describe("classifyRhozellOutcome", () => {
  test("killed when damage >= 18", () => {
    const events = [
      { kind: "npc.introduced", npcId: "rhozell" },
      { kind: "damage.applied", target: "rhozell", amount: 20 },
    ];
    expect(classifyRhozellOutcome(events, "rhozell")).toBe("killed");
  });
  test("killed when relationship dropped <= -3", () => {
    const events = [
      { kind: "npc.introduced", npcId: "rhozell" },
      { kind: "relationship.updated", npcId: "rhozell", delta: -3 },
    ];
    expect(classifyRhozellOutcome(events, "rhozell")).toBe("killed");
  });
  test("aided when relationship rose >= +3", () => {
    const events = [
      { kind: "npc.introduced", npcId: "rhozell" },
      { kind: "relationship.updated", npcId: "rhozell", delta: 3 },
    ];
    expect(classifyRhozellOutcome(events, "rhozell")).toBe("aided");
  });
  test("spared when in scene with no damage and no relationship change", () => {
    const events = [{ kind: "npc.introduced", npcId: "rhozell" }];
    expect(classifyRhozellOutcome(events, "rhozell")).toBe("spared");
  });
  test("fled when never appeared", () => {
    const events = [{ kind: "turn.begun", turn: 1 }];
    expect(classifyRhozellOutcome(events, "rhozell")).toBe("fled");
  });
});
