/**
 * Pure-function tests for the energy state machine. Persistence is
 * exercised in the integration test.
 */
import { applyRegen, viewState } from "@/lib/energy/state";
import {
  BLESSING_OF_THE_GODS,
  effectiveTier,
  getTier,
  TIERS,
  turnsPerDay,
} from "@/lib/energy/tiers";

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
      { energy: 5, lastUpdatedAt: T0, tierId: "free", accountCreatedAt: null, streak: { count: 0, lastDayUtc: null } },
      free,
      T0ms,
    );
    expect(r.energy).toBe(5);
    expect(r.lastUpdatedAt.getTime()).toBe(T0ms);
  });

  test("noop when not enough time has elapsed for one tick", () => {
    const r = applyRegen(
      { energy: 5, lastUpdatedAt: T0, tierId: "free", accountCreatedAt: null, streak: { count: 0, lastDayUtc: null } },
      free,
      T0ms + free.regenIntervalMs - 1,
    );
    expect(r.energy).toBe(5);
  });

  test("credits exactly one tick after one interval", () => {
    const r = applyRegen(
      { energy: 5, lastUpdatedAt: T0, tierId: "free", accountCreatedAt: null, streak: { count: 0, lastDayUtc: null } },
      free,
      T0ms + free.regenIntervalMs,
    );
    expect(r.energy).toBe(6);
    expect(r.lastUpdatedAt.getTime()).toBe(T0ms + free.regenIntervalMs);
  });

  test("credits multiple ticks for multiple intervals", () => {
    const r = applyRegen(
      { energy: 5, lastUpdatedAt: T0, tierId: "free", accountCreatedAt: null, streak: { count: 0, lastDayUtc: null } },
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
      { energy: 18, lastUpdatedAt: T0, tierId: "free", accountCreatedAt: null, streak: { count: 0, lastDayUtc: null } },
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
      { energy: free.max, lastUpdatedAt: T0, tierId: "free", accountCreatedAt: null, streak: { count: 0, lastDayUtc: null } },
      free,
      now,
    );
    expect(r.energy).toBe(free.max);
    expect(r.lastUpdatedAt.getTime()).toBe(now);
  });

  test("ignores negative elapsed (clock skew)", () => {
    const r = applyRegen(
      { energy: 5, lastUpdatedAt: new Date(T0ms + 10_000), tierId: "free", accountCreatedAt: null, streak: { count: 0, lastDayUtc: null } },
      free,
      T0ms,
    );
    expect(r.energy).toBe(5);
  });

  test("partial-interval remainder accumulates correctly across calls", () => {
    // Step 1: 50min elapsed at 45min interval = 1 tick, 5min carryover
    const r1 = applyRegen(
      { energy: 5, lastUpdatedAt: T0, tierId: "free", accountCreatedAt: null, streak: { count: 0, lastDayUtc: null } },
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
      { energy: 5, lastUpdatedAt: T0, tierId: "free", accountCreatedAt: null, streak: { count: 0, lastDayUtc: null } },
      free,
      T0ms + 10 * 60 * 1000, // 10min into a 45min interval
    );
    // 35min remaining
    expect(v.nextRegenMs).toBeCloseTo(35 * 60 * 1000, -3);
  });

  test("nextRegenMs is 0 at max", () => {
    const v = viewState(
      { energy: free.max, lastUpdatedAt: T0, tierId: "free", accountCreatedAt: null, streak: { count: 0, lastDayUtc: null } },
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
      { energy: 5, lastUpdatedAt: T0, tierId: "free", accountCreatedAt: null, streak: { count: 0, lastDayUtc: null } },
      free,
      now,
    );
    const expected = now + 15 * free.regenIntervalMs;
    expect(v.fullAtMs).toBe(expected);
  });
});

describe("effectiveTier (Blessing of the Gods)", () => {
  const now = Date.now();

  test("free tier with no createdAt = no blessing", () => {
    const r = effectiveTier(TIERS.free, null, now);
    expect(r.blessing).toBeNull();
    expect(r.tier.max).toBe(TIERS.free.max);
  });

  test("free tier within 7 days = blessed", () => {
    const created = new Date(now - 1 * 24 * 60 * 60 * 1000); // 1 day old
    const r = effectiveTier(TIERS.free, created, now);
    expect(r.blessing?.id).toBe("blessing-of-the-gods");
    expect(r.tier.max).toBe(TIERS.free.max * 2);
    expect(r.tier.regenIntervalMs).toBeLessThan(TIERS.free.regenIntervalMs);
  });

  test("free tier exactly at 7 days = blessing expired", () => {
    const created = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const r = effectiveTier(TIERS.free, created, now);
    expect(r.blessing).toBeNull();
    expect(r.tier.max).toBe(TIERS.free.max);
  });

  test("supporter tier never gets the blessing (paid tiers don't need a lure)", () => {
    const created = new Date(now - 1 * 24 * 60 * 60 * 1000);
    const r = effectiveTier(TIERS.supporter, created, now);
    expect(r.blessing).toBeNull();
    expect(r.tier.max).toBe(TIERS.supporter.max);
  });

  test("patron tier never gets the blessing", () => {
    const created = new Date(now - 1 * 24 * 60 * 60 * 1000);
    const r = effectiveTier(TIERS.patron, created, now);
    expect(r.blessing).toBeNull();
    expect(r.tier.max).toBe(TIERS.patron.max);
  });

  test("blessed regen approximates supporter pace (~20min)", () => {
    const created = new Date(now);
    const r = effectiveTier(TIERS.free, created, now);
    // 45min / 2.25 = 20min exactly
    expect(r.tier.regenIntervalMs).toBe(20 * 60 * 1000);
  });

  test("blessed turns/day matches supporter (~72)", () => {
    const created = new Date(now);
    const r = effectiveTier(TIERS.free, created, now);
    expect(turnsPerDay(r.tier)).toBe(72);
  });

  test("blessingExpiresAtMs is created+7d", () => {
    const created = new Date(now);
    const r = effectiveTier(TIERS.free, created, now);
    expect(r.blessingExpiresAtMs).toBe(
      created.getTime() + BLESSING_OF_THE_GODS.durationMs,
    );
  });

  test("future-dated createdAt (clock skew) treated as no blessing", () => {
    const created = new Date(now + 1000);
    const r = effectiveTier(TIERS.free, created, now);
    expect(r.blessing).toBeNull();
  });
});

describe("blessing applied through viewState + applyRegen", () => {
  test("blessed free player has cap 40 and 20-min regen end-to-end", () => {
    const created = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const eff = effectiveTier(TIERS.free, created, Date.now());
    expect(eff.tier.max).toBe(40);
    // 100 minutes with 20min interval = 5 ticks
    const start = new Date(Date.now() - 100 * 60 * 1000);
    const r = applyRegen(
      {
        energy: 0,
        lastUpdatedAt: start,
        tierId: "free",
        accountCreatedAt: created,
        streak: { count: 0, lastDayUtc: null },
      },
      eff.tier,
      Date.now(),
    );
    expect(r.energy).toBe(5);
  });

  test("viewState surfaces blessing when active", () => {
    const created = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const eff = effectiveTier(TIERS.free, created, Date.now());
    const v = viewState(
      {
        energy: 5,
        lastUpdatedAt: new Date(),
        tierId: "free",
        accountCreatedAt: created,
        streak: { count: 0, lastDayUtc: null },
      },
      eff.tier,
      Date.now(),
    );
    expect(v.blessing?.id).toBe("blessing-of-the-gods");
    expect(v.blessingExpiresAtMs).not.toBeNull();
  });

  test("viewState shows null blessing for unblessed free player", () => {
    const v = viewState(
      {
        energy: 5,
        lastUpdatedAt: new Date(),
        tierId: "free",
        accountCreatedAt: null,
        streak: { count: 0, lastDayUtc: null },
      },
      TIERS.free,
      Date.now(),
    );
    expect(v.blessing).toBeNull();
  });
});
