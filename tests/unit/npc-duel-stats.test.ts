/**
 * NPC duel stats — pure-function tests.
 *
 * Covers the loader (template → duel stats) for the four
 * dueling-tagged templates we ship, plus default fallback for an
 * unknown template, plus determinism of rollAcceptance.
 */
import {
  _resetNpcDuelCacheForTests,
  getNpcDuelStats,
  rollAcceptance,
} from "@/lib/duels/npc-stats";

beforeEach(() => {
  _resetNpcDuelCacheForTests();
});

describe("getNpcDuelStats — explicit dueling config", () => {
  test("rhozell: explicit acceptance 0.95 + modifier 2 + trashTalk pool", () => {
    const s = getNpcDuelStats("rhozell");
    expect(s.acceptance).toBeCloseTo(0.95);
    expect(s.modifier).toBe(2);
    expect(s.faction).toBe("wyrm_loyal");
    expect(s.trashTalk.length).toBeGreaterThan(0);
    expect(s.refusalLine).not.toBeNull();
  });

  test("captain-mira: low acceptance (0.4) + good modifier (2)", () => {
    const s = getNpcDuelStats("captain-mira-of-the-anchor");
    expect(s.acceptance).toBeCloseTo(0.4);
    expect(s.modifier).toBe(2);
    expect(s.faction).toBe("halfling");
  });

  test("the-binder: low acceptance (0.25), reluctant", () => {
    const s = getNpcDuelStats("the-binder");
    expect(s.acceptance).toBeCloseTo(0.25);
    expect(s.modifier).toBe(1);
    expect(s.refusalLine).toMatch(/find someone else/);
  });

  test("wrong-reader: medium-high acceptance (0.7)", () => {
    const s = getNpcDuelStats("wrong-reader");
    expect(s.acceptance).toBeCloseTo(0.7);
    expect(s.modifier).toBe(0);
  });
});

describe("getNpcDuelStats — fallbacks", () => {
  test("unknown templateId returns DEFAULT_DUEL_STATS shape", () => {
    const s = getNpcDuelStats("not-a-real-npc");
    expect(s.acceptance).toBeCloseTo(0.5);
    expect(s.modifier).toBe(0);
    expect(s.faction).toBeNull();
    expect(s.trashTalk).toEqual([]);
    expect(s.refusalLine).toBeNull();
  });

  test("ambient-threat (no dueling block, just stats) gets a derived modifier", () => {
    const s = getNpcDuelStats("ambient-threat");
    // Specific values depend on the template; we just assert
    // the lookup didn't crash and produced numeric outputs in
    // the legal ranges.
    expect(s.acceptance).toBeGreaterThanOrEqual(0);
    expect(s.acceptance).toBeLessThanOrEqual(1);
    expect(s.modifier).toBeGreaterThanOrEqual(-2);
    expect(s.modifier).toBeLessThanOrEqual(3);
  });
});

describe("rollAcceptance", () => {
  test("deterministic for same seed + acceptance", () => {
    const a = rollAcceptance({ seed: 12345, acceptance: 0.5 });
    const b = rollAcceptance({ seed: 12345, acceptance: 0.5 });
    expect(a).toBe(b);
  });

  test("acceptance=1 always accepts", () => {
    for (let s = 1; s < 30; s++) {
      expect(rollAcceptance({ seed: s, acceptance: 1 })).toBe(true);
    }
  });

  test("acceptance=0 always refuses", () => {
    for (let s = 1; s < 30; s++) {
      expect(rollAcceptance({ seed: s, acceptance: 0 })).toBe(false);
    }
  });

  test("acceptance=0.5 produces both outcomes across 200 seeds", () => {
    let accepts = 0;
    for (let s = 1; s < 200; s++) {
      if (rollAcceptance({ seed: s, acceptance: 0.5 })) accepts += 1;
    }
    // ~half. Loose: between 30% and 70% of 199.
    expect(accepts).toBeGreaterThan(60);
    expect(accepts).toBeLessThan(140);
  });
});
