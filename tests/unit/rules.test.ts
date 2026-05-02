import {
  bandFor,
  PARTIAL_THRESHOLD,
  roll2d6,
  rollFromDice,
  SUCCESS_THRESHOLD,
} from "@/lib/game/rules";

describe("bandFor", () => {
  test("6 and below is miss", () => {
    expect(bandFor(2)).toBe("miss");
    expect(bandFor(6)).toBe("miss");
  });
  test("7..9 is partial", () => {
    expect(bandFor(7)).toBe("partial");
    expect(bandFor(9)).toBe("partial");
  });
  test("10+ is success", () => {
    expect(bandFor(10)).toBe("success");
    expect(bandFor(15)).toBe("success");
  });
  test("boundaries match exported thresholds", () => {
    expect(bandFor(PARTIAL_THRESHOLD - 1)).toBe("miss");
    expect(bandFor(PARTIAL_THRESHOLD)).toBe("partial");
    expect(bandFor(SUCCESS_THRESHOLD - 1)).toBe("partial");
    expect(bandFor(SUCCESS_THRESHOLD)).toBe("success");
  });
});

describe("roll2d6", () => {
  test("is deterministic for a given seed", () => {
    const a = roll2d6(42, 0);
    const b = roll2d6(42, 0);
    expect(a).toEqual(b);
  });

  test("returns d1, d2 in 1..6", () => {
    for (let seed = 1; seed < 200; seed++) {
      const r = roll2d6(seed, 0);
      expect(r.d1).toBeGreaterThanOrEqual(1);
      expect(r.d1).toBeLessThanOrEqual(6);
      expect(r.d2).toBeGreaterThanOrEqual(1);
      expect(r.d2).toBeLessThanOrEqual(6);
    }
  });

  test("modifier flows through to total and band", () => {
    const r = roll2d6(42, 3);
    expect(r.total).toBe(r.d1 + r.d2 + 3);
    expect(r.band).toBe(bandFor(r.total));
  });

  test("seed is preserved in result", () => {
    const r = roll2d6(99, 0);
    expect(r.seed).toBe(99);
  });
});

describe("rollFromDice", () => {
  test("constructs a synthetic roll without PRNG", () => {
    const r = rollFromDice(6, 6, 0);
    expect(r.total).toBe(12);
    expect(r.band).toBe("success");
    expect(r.seed).toBe(0);
  });

  test("rejects out-of-range dice", () => {
    expect(() => rollFromDice(0, 5)).toThrow();
    expect(() => rollFromDice(7, 1)).toThrow();
  });
});
