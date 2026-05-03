/**
 * Pure-function tests for the energy state machine. Persistence is
 * exercised in the integration test.
 */
import { applyRegen, viewState } from "@/lib/energy/state";
import { getTier, TIERS, turnsPerDay } from "@/lib/energy/tiers";

describe("getTier", () => {
  test("returns the named tier when present", () => {
    expect(getTier("free").id).toBe("free");
    expect(getTier("supporter").id).toBe("supporter");
    expect(getTier("patron").id).toBe("patron");
  });
  test("returns free for unknown / null / undefined", () => {
    expect(getTier(null).id).toBe("free");
    expect(getTier(undefined).id).toBe("free");
    expect(getTier("doesnotexist").id).toBe("free");
  });
});

describe("turnsPerDay", () => {
  test("free tier yields ~32/day", () => {
    expect(turnsPerDay(TIERS.free)).toBe(32);
  });
  test("supporter ~72/day", () => {
    expect(turnsPerDay(TIERS.supporter)).toBe(72);
  });
  test("patron ~144/day", () => {
    expect(turnsPerDay(TIERS.patron)).toBe(144);
  });
});

describe("applyRegen", () => {
  const T0 = new Date("2026-05-03T12:00:00Z");
  const T0ms = T0.getTime();
  const free = TIERS.free;

  test("noop when no time has elapsed", () => {
    const r = applyRegen(
      { energy: 5, lastUpdatedAt: T0, tierId: "free" },
      free,
      T0ms,
    );
    expect(r.energy).toBe(5);
    expect(r.lastUpdatedAt.getTime()).toBe(T0ms);
  });

  test("noop when not enough time has elapsed for one tick", () => {
    const r = applyRegen(
      { energy: 5, lastUpdatedAt: T0, tierId: "free" },
      free,
      T0ms + free.regenIntervalMs - 1,
    );
    expect(r.energy).toBe(5);
  });

  test("credits exactly one tick after one interval", () => {
    const r = applyRegen(
      { energy: 5, lastUpdatedAt: T0, tierId: "free" },
      free,
      T0ms + free.regenIntervalMs,
    );
    expect(r.energy).toBe(6);
    expect(r.lastUpdatedAt.getTime()).toBe(T0ms + free.regenIntervalMs);
  });

  test("credits multiple ticks for multiple intervals", () => {
    const r = applyRegen(
      { energy: 5, lastUpdatedAt: T0, tierId: "free" },
      free,
      T0ms + free.regenIntervalMs * 3 + 10_000,
    );
    expect(r.energy).toBe(8);
    // lastUpdated advanced by exactly 3 intervals — the 10s remainder
    // carries forward to the next tick.
    expect(r.lastUpdatedAt.getTime()).toBe(
      T0ms + free.regenIntervalMs * 3,
    );
  });

  test("clamps at tier max", () => {
    const r = applyRegen(
      { energy: 18, lastUpdatedAt: T0, tierId: "free" },
      free,
      T0ms + free.regenIntervalMs * 50,
    );
    expect(r.energy).toBe(free.max);
  });

  test("when at max, fast-forwards lastUpdated to now", () => {
    // Player at max for an hour; the next spend should still wait a
    // full interval before regen resumes — no stash.
    const now = T0ms + 60 * 60 * 1000;
    const r = applyRegen(
      { energy: free.max, lastUpdatedAt: T0, tierId: "free" },
      free,
      now,
    );
    expect(r.energy).toBe(free.max);
    expect(r.lastUpdatedAt.getTime()).toBe(now);
  });

  test("ignores negative elapsed (clock skew)", () => {
    const r = applyRegen(
      { energy: 5, lastUpdatedAt: new Date(T0ms + 10_000), tierId: "free" },
      free,
      T0ms,
    );
    expect(r.energy).toBe(5);
  });

  test("partial-interval remainder accumulates correctly across calls", () => {
    // Step 1: 50min elapsed at 45min interval = 1 tick, 5min carryover
    const r1 = applyRegen(
      { energy: 5, lastUpdatedAt: T0, tierId: "free" },
      free,
      T0ms + 50 * 60 * 1000,
    );
    expect(r1.energy).toBe(6);
    // Step 2: another 40min elapsed (total 90min from T0). The carry
    // 5min + 40min = 45min = exactly one more tick.
    const r2 = applyRegen(
      r1,
      free,
      T0ms + 90 * 60 * 1000,
    );
    expect(r2.energy).toBe(7);
  });
});

describe("viewState", () => {
  const T0 = new Date("2026-05-03T12:00:00Z");
  const T0ms = T0.getTime();
  const free = TIERS.free;

  test("nextRegenMs is correct mid-interval", () => {
    const v = viewState(
      { energy: 5, lastUpdatedAt: T0, tierId: "free" },
      free,
      T0ms + 10 * 60 * 1000, // 10min into a 45min interval
    );
    // 35min remaining
    expect(v.nextRegenMs).toBeCloseTo(35 * 60 * 1000, -3);
  });

  test("nextRegenMs is 0 at max", () => {
    const v = viewState(
      { energy: free.max, lastUpdatedAt: T0, tierId: "free" },
      free,
      T0ms + 1000,
    );
    expect(v.nextRegenMs).toBe(0);
    expect(v.fullAtMs).toBeNull();
  });

  test("fullAtMs computes the right time", () => {
    // 5 energy, max 20 → need 15 ticks. First tick in 45min, then
    // 14 more at 45min apiece = (1 + 14) * 45min from now.
    const now = T0ms;
    const v = viewState(
      { energy: 5, lastUpdatedAt: T0, tierId: "free" },
      free,
      now,
    );
    const expected = now + 15 * free.regenIntervalMs;
    expect(v.fullAtMs).toBe(expected);
  });
});
