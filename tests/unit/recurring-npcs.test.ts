import {
  appearanceProbabilityFor,
  clearRecurringNpcCache,
  listRecurringNpcs,
  pickRecurringNpc,
  type RecurringNpcMeta,
} from "@/lib/antagonist/recurring";

beforeEach(() => clearRecurringNpcCache());

describe("listRecurringNpcs", () => {
  test("includes Rhozell from content/npcs/rhozell.json", () => {
    const list = listRecurringNpcs();
    expect(list.some((n) => n.templateId === "rhozell")).toBe(true);
  });

  test("excludes non-recurring NPCs", () => {
    const list = listRecurringNpcs();
    expect(list.some((n) => n.templateId === "tunnel-rat")).toBe(false);
    expect(list.some((n) => n.templateId === "tutorial-vendor")).toBe(false);
  });
});

const FAKE_META: RecurringNpcMeta = {
  templateId: "fake",
  recurring: true,
  appearanceProbability: {
    baseLow: 0.05,
    baseHigh: 0.25,
    wyrmPhaseThreshold: 0.5,
    perPriorEncounterBonus: 0.1,
    maxAppearanceProbability: 0.6,
  },
};

describe("appearanceProbabilityFor", () => {
  test("uses baseLow when arcProgress below threshold", () => {
    expect(
      appearanceProbabilityFor({
        meta: FAKE_META,
        arcProgress: 0.3,
        priorEncounters: 0,
      }),
    ).toBeCloseTo(0.05, 5);
  });

  test("uses baseHigh when arcProgress >= threshold", () => {
    expect(
      appearanceProbabilityFor({
        meta: FAKE_META,
        arcProgress: 0.5,
        priorEncounters: 0,
      }),
    ).toBeCloseTo(0.25, 5);
  });

  test("priors bump probability", () => {
    expect(
      appearanceProbabilityFor({
        meta: FAKE_META,
        arcProgress: 0.1,
        priorEncounters: 3,
      }),
    ).toBeCloseTo(0.05 + 0.3, 5);
  });

  test("clamps at maxAppearanceProbability", () => {
    expect(
      appearanceProbabilityFor({
        meta: FAKE_META,
        arcProgress: 0.9,
        priorEncounters: 100,
      }),
    ).toBeLessThanOrEqual(0.6);
  });
});

describe("pickRecurringNpc", () => {
  test("forceFire bypasses probability", () => {
    const r = pickRecurringNpc({
      seed: 0,
      arcProgress: 0,
      priorEncountersByNpc: {},
      introducedTemplateIds: new Set(),
      forceFire: "rhozell",
    });
    expect(r?.templateId).toBe("rhozell");
  });

  test("deterministic per seed", () => {
    const a = pickRecurringNpc({
      seed: 42,
      arcProgress: 0.6,
      priorEncountersByNpc: {},
      introducedTemplateIds: new Set(),
    });
    const b = pickRecurringNpc({
      seed: 42,
      arcProgress: 0.6,
      priorEncountersByNpc: {},
      introducedTemplateIds: new Set(),
    });
    expect(a?.templateId).toBe(b?.templateId);
  });

  test("already-introduced NPCs are skipped", () => {
    const r = pickRecurringNpc({
      seed: 0,
      arcProgress: 1,
      priorEncountersByNpc: {},
      introducedTemplateIds: new Set(["rhozell"]),
      forceFire: "rhozell",
    });
    // forceFire is honored even when introduced — caller decides.
    // Without forceFire, rhozell would skip. Verify the skip path:
    const skipped = pickRecurringNpc({
      seed: 1,
      arcProgress: 1,
      priorEncountersByNpc: { rhozell: 0 },
      introducedTemplateIds: new Set(["rhozell"]),
    });
    // With rhozell skipped, the engine should look at the next
    // recurring entry alphabetically. The result is null OR a
    // non-rhozell template.
    if (skipped) expect(skipped.templateId).not.toBe("rhozell");
    expect(r?.templateId).toBe("rhozell"); // forceFire override path
  });

  test("low arcProgress + zero priors produces few hits across seeds", () => {
    let hits = 0;
    for (let s = 1; s < 200; s++) {
      const r = pickRecurringNpc({
        seed: s,
        arcProgress: 0.1,
        priorEncountersByNpc: {},
        introducedTemplateIds: new Set(),
      });
      if (r) hits += 1;
    }
    // Base prob is 0.03 for rhozell at arcProgress=0.1 → roughly 6
    // hits in 200 seeds. Generous upper bound for stability.
    expect(hits).toBeLessThan(40);
  });
});
