import { deriveSeed, mulberry32, rollDie } from "@/lib/util/rng";

describe("mulberry32", () => {
  test("same seed → same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  test("different seeds → different first draw", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  test("output is in [0, 1)", () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("rollDie returns 1..6 over many draws", () => {
    const rng = mulberry32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(rollDie(rng));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("deriveSeed", () => {
  test("same (sessionSeed, seq) → same derived seed", () => {
    expect(deriveSeed(42, 1)).toBe(deriveSeed(42, 1));
  });

  test("different seqs → different derived seeds", () => {
    expect(deriveSeed(42, 1)).not.toBe(deriveSeed(42, 2));
  });

  test("different sessionSeeds → different derived seeds", () => {
    expect(deriveSeed(42, 1)).not.toBe(deriveSeed(43, 1));
  });
});
