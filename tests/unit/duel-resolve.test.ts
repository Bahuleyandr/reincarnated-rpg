/**
 * Duel resolution — pure-function tests for the dice math.
 *
 * Resolution touches the DB; the integration test for that path
 * lives elsewhere. Here we cover only the pure rollDuelSide
 * + the determinism + faction-bonus rules.
 */
import { rollDuelSide } from "@/lib/duels/resolve";

describe("rollDuelSide", () => {
  test("d1 + d2 fall in 1..6, total = d1+d2", () => {
    for (let s = 1; s < 50; s++) {
      const r = rollDuelSide({ seed: s, factionMatches: false });
      expect(r.d1).toBeGreaterThanOrEqual(1);
      expect(r.d1).toBeLessThanOrEqual(6);
      expect(r.d2).toBeGreaterThanOrEqual(1);
      expect(r.d2).toBeLessThanOrEqual(6);
      expect(r.total).toBe(r.d1 + r.d2);
    }
  });

  test("factionMatches adds +1 bonus to finalTotal", () => {
    const a = rollDuelSide({ seed: 42, factionMatches: false });
    const b = rollDuelSide({ seed: 42, factionMatches: true });
    expect(a.factionBonus).toBe(0);
    expect(b.factionBonus).toBe(1);
    expect(a.total).toBe(b.total);
    expect(b.finalTotal).toBe(a.finalTotal + 1);
  });

  test("same seed = same roll (deterministic)", () => {
    const a = rollDuelSide({ seed: 100, factionMatches: false });
    const b = rollDuelSide({ seed: 100, factionMatches: false });
    expect(a).toEqual(b);
  });

  test("different seeds produce different distributions", () => {
    const totals = new Set<number>();
    for (let s = 1; s < 50; s++) {
      const r = rollDuelSide({ seed: s, factionMatches: false });
      totals.add(r.total);
    }
    // Across 50 different seeds, the distinct totals should
    // span more than half of the 2..12 range (would be 11 values).
    expect(totals.size).toBeGreaterThanOrEqual(6);
  });
});
