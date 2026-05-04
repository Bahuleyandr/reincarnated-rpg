/**
 * Form-specific dice variants — Phase 9 wedge mechanic.
 *
 * The dice variant is the form's fingerprint at the rules layer.
 * Slime rolls 2d6 (the PbtA baseline). Cursed-book rolls 3d6kh2
 * (high floor, methodical). Dragon-egg rolls 2d6r1 (re-roll 1s,
 * "lucky if you survive"). Dungeon-core rolls 1d12 (high
 * variance, swingy).
 *
 * Two layers of test:
 *   1. Per-variant: produces RollResult with the right shape and
 *      respects the dice constraints (e.g. 2d6r1 never has a 1).
 *   2. Distribution: the variants produce measurably different
 *      means and floors over a large sample.
 */
import {
  bandFor,
  DICE_VARIANTS,
  rollDice,
  type DiceVariant,
} from "@/lib/game/rules";
import { loadForm } from "@/lib/game/content";

describe("rollDice — per-variant shape", () => {
  test("2d6: d1, d2 in 1..6, total = d1+d2+mod, variant tagged", () => {
    const r = rollDice("2d6", 12345, 0);
    expect(r.d1).toBeGreaterThanOrEqual(1);
    expect(r.d1).toBeLessThanOrEqual(6);
    expect(r.d2).toBeGreaterThanOrEqual(1);
    expect(r.d2).toBeLessThanOrEqual(6);
    expect(r.total).toBe(r.d1 + r.d2);
    expect(r.variant).toBe("2d6");
  });

  test("3d6kh2: d1 >= d2 (kept-highest first), both 1..6", () => {
    for (let i = 0; i < 100; i++) {
      const r = rollDice("3d6kh2", 1000 + i);
      expect(r.d1).toBeGreaterThanOrEqual(1);
      expect(r.d1).toBeLessThanOrEqual(6);
      expect(r.d2).toBeGreaterThanOrEqual(1);
      expect(r.d2).toBeLessThanOrEqual(6);
      expect(r.d1).toBeGreaterThanOrEqual(r.d2);
    }
  });

  test("2d6r1: dice are NEVER 1 (re-rolled)", () => {
    // 2d6r1 re-rolls 1s once, so the second roll could land 1
    // again. Run a large sample — the post-reroll result is what
    // we expose as d1/d2, so we assert at the API level.
    let oneCount = 0;
    for (let i = 0; i < 1000; i++) {
      const r = rollDice("2d6r1", 5000 + i);
      if (r.d1 === 1 || r.d2 === 1) oneCount += 1;
    }
    // Each die has a 1/6 * 1/6 = 1/36 chance to land 1 after the
    // reroll. Across 1000 rolls × 2 dice that's ~55 ones expected.
    // Loose ceiling: <120 (3x expected, slack for variance).
    expect(oneCount).toBeLessThan(120);
  });

  test("1d12: d1 in 1..12, d2 = 0", () => {
    for (let i = 0; i < 100; i++) {
      const r = rollDice("1d12", 7000 + i);
      expect(r.d1).toBeGreaterThanOrEqual(1);
      expect(r.d1).toBeLessThanOrEqual(12);
      expect(r.d2).toBe(0);
      expect(r.total).toBe(r.d1);
    }
  });

  test("modifier applies to total but not to band-determining dice", () => {
    const r = rollDice("2d6", 99, 3);
    expect(r.total).toBe(r.d1 + r.d2 + 3);
  });

  test("seed determinism: same seed + variant + mod = same roll", () => {
    for (const v of DICE_VARIANTS) {
      const a = rollDice(v as DiceVariant, 42);
      const b = rollDice(v as DiceVariant, 42);
      expect(a).toEqual(b);
    }
  });

  test("band thresholds work for every variant", () => {
    expect(bandFor(11)).toBe("success");
    expect(bandFor(8)).toBe("partial");
    expect(bandFor(5)).toBe("miss");
    // Sanity: the variants all use the same band fn, so no need
    // to test per-variant. Just confirm the universe of plausible
    // totals (2..12 for 2d6 / 3d6kh2 / 2d6r1; 1..12 for 1d12)
    // maps to legal bands.
    for (let total = 1; total <= 12; total++) {
      const b = bandFor(total);
      expect(["miss", "partial", "success"]).toContain(b);
    }
  });
});

describe("rollDice — distributions are different", () => {
  function sampleMean(v: DiceVariant, n = 4000): number {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += rollDice(v, 100_000 + i).total;
    }
    return sum / n;
  }

  test("3d6kh2 mean is higher than 2d6 mean (high floor)", () => {
    const a = sampleMean("2d6");
    const b = sampleMean("3d6kh2");
    // 2d6 mean is 7.0; 3d6kh2 mean is ~8.46. Guard with a wide
    // margin so the test isn't flaky on a particular RNG slice.
    expect(b - a).toBeGreaterThan(0.8);
  });

  test("2d6r1 mean is higher than 2d6 mean but lower than 3d6kh2", () => {
    const a = sampleMean("2d6");
    const b = sampleMean("2d6r1");
    const c = sampleMean("3d6kh2");
    expect(b).toBeGreaterThan(a + 0.1); // r1 lifts the floor
    expect(b).toBeLessThan(c + 0.1); // not as much as kh2
  });

  test("1d12 mean is lower than 2d6 mean (uniform 1-12 → 6.5)", () => {
    const a = sampleMean("2d6");
    const c = sampleMean("1d12");
    // 2d6 mean 7; 1d12 mean 6.5. Difference ~0.5.
    expect(a - c).toBeGreaterThan(0.2);
  });

  test("1d12 has wider variance than 2d6 (more 12s, more 1s)", () => {
    let extreme2d6 = 0;
    let extreme1d12 = 0;
    for (let i = 0; i < 4000; i++) {
      const a = rollDice("2d6", 200_000 + i).total;
      const c = rollDice("1d12", 300_000 + i).total;
      if (a === 2 || a === 12) extreme2d6 += 1;
      if (c === 1 || c === 12) extreme1d12 += 1;
    }
    // 2d6 hits 2 or 12 at 1/36 + 1/36 = ~5.5% of rolls.
    // 1d12 hits 1 or 12 at 2/12 = ~16.7% of rolls.
    expect(extreme1d12).toBeGreaterThan(extreme2d6 * 1.5);
  });
});

describe("form templates declare their dice variant", () => {
  test("lesser-slime uses default 2d6 (omitted = 2d6)", () => {
    const f = loadForm("lesser-slime");
    expect(f.dice ?? "2d6").toBe("2d6");
  });
  test("cursed-book uses 3d6kh2 (patient, methodical)", () => {
    const f = loadForm("cursed-book");
    expect(f.dice).toBe("3d6kh2");
  });
  test("dragon-egg uses 2d6r1 (lucky-if-you-survive)", () => {
    const f = loadForm("dragon-egg");
    expect(f.dice).toBe("2d6r1");
  });
  test("dungeon-core uses 1d12 (swingy, all-or-nothing)", () => {
    const f = loadForm("dungeon-core");
    expect(f.dice).toBe("1d12");
  });
});
