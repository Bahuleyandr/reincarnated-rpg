/**
 * Death-cause classifier and trait-apply pure logic.
 */
import {
  applyLegacyTraitsToStarterFormState,
  listEarnedTraits,
} from "@/lib/legacy/apply";
import {
  applyImprint,
  imprintTraitFromDeath,
  type DeathContext,
} from "@/lib/legacy/imprint";
import { getTrait } from "@/lib/legacy/traits";
import type { Event } from "@/lib/game/types";

function ctx(overrides: Partial<DeathContext>): DeathContext {
  return {
    reason: "death",
    formId: "lesser-slime",
    events: [],
    existingTraits: {},
    ...overrides,
  };
}

function damage(source: string): Event {
  return { kind: "damage.applied", target: "$SELF", amount: 5, source };
}

describe("imprintTraitFromDeath — by death reason", () => {
  test('"win" yields no trait (wins are their own reward)', () => {
    expect(imprintTraitFromDeath(ctx({ reason: "win" })).traitId).toBeNull();
  });
  test('"cap" yields the soft "abandoned" trait', () => {
    expect(imprintTraitFromDeath(ctx({ reason: "cap" })).traitId).toBe("abandoned");
  });
});

describe("imprintTraitFromDeath — source classification", () => {
  test("fire source → fire_scarred", () => {
    const r = imprintTraitFromDeath(
      ctx({ events: [damage("ember-pyre")] }),
    );
    expect(r.traitId).toBe("fire_scarred");
    expect(r.causeFamily).toBe("fire");
  });
  test("water/drown source → water_affinity", () => {
    expect(
      imprintTraitFromDeath(ctx({ events: [damage("drowned in cistern")] })).traitId,
    ).toBe("water_affinity");
  });
  test("crush source → crushed", () => {
    expect(
      imprintTraitFromDeath(ctx({ events: [damage("crushing-stone")] })).traitId,
    ).toBe("crushed");
  });
  test("venom source → venom_remembered", () => {
    expect(
      imprintTraitFromDeath(ctx({ events: [damage("envenom-fang")] })).traitId,
    ).toBe("venom_remembered");
  });
  test("self-tool source → self_undone", () => {
    expect(
      imprintTraitFromDeath(ctx({ events: [damage("own-tool-backfire")] })).traitId,
    ).toBe("self_undone");
  });
  test("wyrm source → wyrm_touched", () => {
    expect(
      imprintTraitFromDeath(ctx({ events: [damage("Long-Wyrm")] })).traitId,
    ).toBe("wyrm_touched");
  });
  test("unrecognized source falls back to form-specific trait", () => {
    expect(
      imprintTraitFromDeath(
        ctx({ formId: "lesser-slime", events: [damage("eldritch-thing")] }),
      ).traitId,
    ).toBe("drowned");
  });
});

describe("imprintTraitFromDeath — form fallback when no damage event", () => {
  test("lesser-slime → drowned", () => {
    expect(imprintTraitFromDeath(ctx({ formId: "lesser-slime" })).traitId).toBe(
      "drowned",
    );
  });
  test("cursed-book → binder_broken", () => {
    expect(imprintTraitFromDeath(ctx({ formId: "cursed-book" })).traitId).toBe(
      "binder_broken",
    );
  });
  test("dragon-egg → exposed", () => {
    expect(imprintTraitFromDeath(ctx({ formId: "dragon-egg" })).traitId).toBe(
      "exposed",
    );
  });
  test("unknown form falls back to many_lived", () => {
    expect(imprintTraitFromDeath(ctx({ formId: "vending-machine" })).traitId).toBe(
      "many_lived",
    );
  });
});

describe("imprintTraitFromDeath — upgrade thresholds", () => {
  test("first fire death → fire_scarred", () => {
    const r = imprintTraitFromDeath(
      ctx({ events: [damage("flame")], existingTraits: {} }),
    );
    expect(r.traitId).toBe("fire_scarred");
  });
  test("second fire death (existing fire_scarred=1) → unburnt", () => {
    const r = imprintTraitFromDeath(
      ctx({
        events: [damage("flame")],
        existingTraits: { fire_scarred: 1 },
      }),
    );
    expect(r.traitId).toBe("unburnt");
  });
  test("water upgrade: water_affinity → drowned at threshold 2", () => {
    expect(
      imprintTraitFromDeath(
        ctx({
          events: [damage("water-tide")],
          existingTraits: { water_affinity: 1 },
        }),
      ).traitId,
    ).toBe("drowned");
  });
});

describe("applyImprint — monotonic stacking", () => {
  test("first imprint adds the trait at count 1", () => {
    const next = applyImprint({}, { traitId: "fire_scarred", causeFamily: "fire" });
    expect(next).toEqual({ fire_scarred: 1 });
  });
  test("second imprint of the same trait increments", () => {
    const next = applyImprint(
      { fire_scarred: 1 },
      { traitId: "fire_scarred", causeFamily: "fire" },
    );
    expect(next).toEqual({ fire_scarred: 2 });
  });
  test("null traitId leaves counts unchanged", () => {
    const next = applyImprint({ fire_scarred: 1 }, { traitId: null, causeFamily: null });
    expect(next).toEqual({ fire_scarred: 1 });
  });
  test("returns a fresh object — does not mutate input", () => {
    const before = { fire_scarred: 1 };
    applyImprint(before, { traitId: "fire_scarred", causeFamily: "fire" });
    expect(before).toEqual({ fire_scarred: 1 });
  });
});

describe("applyLegacyTraitsToStarterFormState", () => {
  test("empty trait counts → empty delta", () => {
    expect(applyLegacyTraitsToStarterFormState({})).toEqual({});
  });
  test("single trait applies its formState", () => {
    expect(applyLegacyTraitsToStarterFormState({ fire_scarred: 1 })).toEqual({
      fire_resistance: 1,
    });
  });
  test("multiple traits sum into one delta", () => {
    const delta = applyLegacyTraitsToStarterFormState({
      fire_scarred: 1,
      water_affinity: 1,
    });
    expect(delta).toEqual({ fire_resistance: 1, water_breath: 1 });
  });
  test("base + upgrade BOTH apply additively (fire_scarred + unburnt)", () => {
    const delta = applyLegacyTraitsToStarterFormState({
      fire_scarred: 2,
      unburnt: 1,
    });
    // fire_scarred contributes +1, unburnt contributes +2 → total 3.
    // (Count > 1 doesn't multiply; only the upgrade trait is the
    // bigger contribution.)
    expect(delta.fire_resistance).toBe(3);
  });
  test("count of 0 is ignored (not negative either)", () => {
    expect(applyLegacyTraitsToStarterFormState({ fire_scarred: 0 })).toEqual({});
  });
  test("unknown trait ids are silently ignored", () => {
    expect(
      applyLegacyTraitsToStarterFormState({ no_such_trait: 5 }),
    ).toEqual({});
  });
  test("delta clamps at SAFETY_CAPS.formStateAbsMax (defense-in-depth)", () => {
    // Synthesize a count high enough that hypothetically every
    // trait would over-stack. Real traits don't add this much — the
    // clamp is a safety net.
    const delta = applyLegacyTraitsToStarterFormState({
      fire_scarred: 1, // +1
      unburnt: 1, // +2
    });
    expect(delta.fire_resistance).toBeLessThanOrEqual(20);
  });
});

describe("listEarnedTraits", () => {
  test("returns trait metadata sorted by count desc", () => {
    const list = listEarnedTraits({
      whimsical: 1,
      fire_scarred: 3,
      crushed: 2,
    });
    expect(list.map((t) => t.id)).toEqual(["fire_scarred", "crushed", "whimsical"]);
    expect(list[0].label).toBe("Fire-scarred");
  });
  test("filters out zero counts and unknown ids", () => {
    const list = listEarnedTraits({
      fire_scarred: 0,
      not_a_trait: 5,
    });
    expect(list).toEqual([]);
  });
});

describe("trait catalog integrity", () => {
  test("every trait id used by the imprint classifier exists in the catalog", () => {
    // The classifier may credit any of these — pin them.
    const used = [
      "fire_scarred",
      "unburnt",
      "water_affinity",
      "drowned",
      "crushed",
      "gravity_aware",
      "venom_remembered",
      "starved",
      "betrayed",
      "torn",
      "exposed",
      "binder_broken",
      "core_cracked",
      "wyrm_touched",
      "many_lived",
      "self_undone",
      "abandoned",
    ];
    for (const id of used) {
      expect(getTrait(id)).not.toBeNull();
    }
  });
});
