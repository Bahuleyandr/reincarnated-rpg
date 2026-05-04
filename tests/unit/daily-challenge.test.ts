/**
 * Daily shared-seed challenge — Wordle-style growth bet.
 *
 * Pure-function tests for the picker + scorer. Determinism is
 * the entire wedge: every player on the same UTC date MUST get
 * the same (form, location, seed) triple, and the score function
 * MUST rank outcomes consistently regardless of which day they
 * landed on.
 */
import {
  CHALLENGE_POOL,
  computeDailyScore,
  pickDailyChallenge,
} from "@/lib/daily/challenge";

describe("pickDailyChallenge", () => {
  test("is deterministic for a given UTC date", () => {
    const a = pickDailyChallenge("2026-05-04");
    const b = pickDailyChallenge("2026-05-04");
    expect(a).toEqual(b);
  });

  test("different dates produce different challenges (eventually)", () => {
    // Across a 30-day window we should see at least 2 distinct
    // (formId, locationId) pairs. The pool has 7 entries so this
    // is essentially guaranteed unless the hash is degenerate.
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const date = `2026-05-${String(i + 1).padStart(2, "0")}`;
      const c = pickDailyChallenge(date);
      seen.add(`${c.formId}::${c.locationId}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test("returns a (form, location) pair from the curated pool", () => {
    const c = pickDailyChallenge("2026-05-04");
    const inPool = CHALLENGE_POOL.some(
      (p) => p.formId === c.formId && p.locationId === c.locationId,
    );
    expect(inPool).toBe(true);
  });

  test("seed is a 32-bit unsigned integer", () => {
    const c = pickDailyChallenge("2026-05-04");
    expect(c.seed).toBeGreaterThanOrEqual(0);
    expect(c.seed).toBeLessThan(2 ** 32);
    expect(Number.isInteger(c.seed)).toBe(true);
  });

  test("seed differs from the date hash (rotation prevents leak)", () => {
    // Without the rotation, the seed would equal the hash that
    // also picks the form/location. Sanity-check that two
    // adjacent days have distinct seeds.
    const a = pickDailyChallenge("2026-05-04");
    const b = pickDailyChallenge("2026-05-05");
    expect(a.seed).not.toBe(b.seed);
  });
});

describe("computeDailyScore", () => {
  test("won is the highest tier; faster wins beat slower wins", () => {
    const fast = computeDailyScore({ status: "won", turnCount: 3 });
    const slow = computeDailyScore({ status: "won", turnCount: 30 });
    expect(fast).toBeGreaterThan(slow);
    // Both well above the capped tier.
    expect(slow).toBeGreaterThan(
      computeDailyScore({ status: "capped", turnCount: 50 }),
    );
  });

  test("capped beats dead at the same turn count", () => {
    const capped = computeDailyScore({ status: "capped", turnCount: 10 });
    const dead = computeDailyScore({ status: "dead", turnCount: 10 });
    expect(capped).toBeGreaterThan(dead);
  });

  test("capped/dead score rewards longer survival (more turns = more)", () => {
    const dead5 = computeDailyScore({ status: "dead", turnCount: 5 });
    const dead8 = computeDailyScore({ status: "dead", turnCount: 8 });
    expect(dead8).toBeGreaterThan(dead5);
    const cap5 = computeDailyScore({ status: "capped", turnCount: 5 });
    const cap8 = computeDailyScore({ status: "capped", turnCount: 8 });
    expect(cap8).toBeGreaterThan(cap5);
  });

  test("active is the lowest tier (in-progress runs sort last)", () => {
    const active = computeDailyScore({ status: "active", turnCount: 5 });
    const dead = computeDailyScore({ status: "dead", turnCount: 5 });
    expect(active).toBeLessThan(dead);
  });

  test("won fast (turn 1) is at the score ceiling", () => {
    expect(computeDailyScore({ status: "won", turnCount: 1 })).toBe(
      10000 + 49,
    );
    // Beyond the 50-turn discount window, won still beats capped:
    expect(computeDailyScore({ status: "won", turnCount: 100 })).toBe(10000);
  });
});
