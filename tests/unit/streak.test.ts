/**
 * Pure-function tests for the daily-streak state machine.
 *
 * Persistence is exercised in tests/integration/energy.test.ts.
 */
import {
  claimDailyStreak,
  isConsecutiveUtcDay,
  MAX_STREAK,
  utcDateString,
} from "@/lib/energy/streak";

describe("utcDateString", () => {
  test("formats midnight UTC as YYYY-MM-DD", () => {
    expect(utcDateString(new Date("2026-05-03T00:00:00Z"))).toBe("2026-05-03");
  });

  test("formats end-of-day UTC still as the same UTC day", () => {
    expect(utcDateString(new Date("2026-05-03T23:59:59Z"))).toBe("2026-05-03");
  });

  test("rolls over at midnight UTC", () => {
    expect(utcDateString(new Date("2026-05-04T00:00:00Z"))).toBe("2026-05-04");
  });

  test("uses UTC, not local time, for non-UTC inputs", () => {
    // 2026-05-03T22:00:00-05:00  is  2026-05-04T03:00:00Z  → UTC day +1
    const d = new Date("2026-05-03T22:00:00-05:00");
    expect(utcDateString(d)).toBe("2026-05-04");
  });

  test("zero-pads month and day", () => {
    expect(utcDateString(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});

describe("isConsecutiveUtcDay", () => {
  test("true for adjacent UTC days", () => {
    expect(isConsecutiveUtcDay("2026-05-03", "2026-05-04")).toBe(true);
  });

  test("false for the same day", () => {
    expect(isConsecutiveUtcDay("2026-05-03", "2026-05-03")).toBe(false);
  });

  test("false when the gap is two days", () => {
    expect(isConsecutiveUtcDay("2026-05-03", "2026-05-05")).toBe(false);
  });

  test("false when today is BEFORE prev (clock skew / replay)", () => {
    expect(isConsecutiveUtcDay("2026-05-04", "2026-05-03")).toBe(false);
  });

  test("crosses month boundary correctly", () => {
    expect(isConsecutiveUtcDay("2026-05-31", "2026-06-01")).toBe(true);
  });

  test("crosses year boundary correctly", () => {
    expect(isConsecutiveUtcDay("2026-12-31", "2027-01-01")).toBe(true);
  });

  test("false for malformed inputs (won't grant on garbage)", () => {
    expect(isConsecutiveUtcDay("not-a-date", "2026-05-04")).toBe(false);
  });
});

describe("claimDailyStreak", () => {
  test("brand-new player (lastDayUtc=null) → grants Day-1, +1 energy", () => {
    const r = claimDailyStreak(
      { count: 0, lastDayUtc: null },
      new Date("2026-05-03T12:00:00Z"),
    );
    expect(r.grant).not.toBeNull();
    expect(r.grant!.streakBefore).toBe(0);
    expect(r.grant!.streakAfter).toBe(1);
    expect(r.grant!.bonusEnergy).toBe(1);
    expect(r.grant!.reachedCap).toBe(false);
    expect(r.state).toEqual({ count: 1, lastDayUtc: "2026-05-03" });
  });

  test("returning the same UTC day = no grant, state unchanged", () => {
    const before = { count: 3, lastDayUtc: "2026-05-03" };
    const r = claimDailyStreak(before, new Date("2026-05-03T18:00:00Z"));
    expect(r.grant).toBeNull();
    expect(r.state).toBe(before); // identity preserved
  });

  test("consecutive day → bumps count by 1, grant scales", () => {
    const r = claimDailyStreak(
      { count: 2, lastDayUtc: "2026-05-03" },
      new Date("2026-05-04T01:00:00Z"),
    );
    expect(r.grant!.streakAfter).toBe(3);
    expect(r.grant!.bonusEnergy).toBe(3);
    expect(r.state).toEqual({ count: 3, lastDayUtc: "2026-05-04" });
  });

  test("missing one day resets count to 1 (not zero — they did log in today)", () => {
    const r = claimDailyStreak(
      { count: 4, lastDayUtc: "2026-05-01" }, // last login 2 days ago
      new Date("2026-05-03T12:00:00Z"),
    );
    expect(r.grant!.streakBefore).toBe(4);
    expect(r.grant!.streakAfter).toBe(1);
    expect(r.grant!.bonusEnergy).toBe(1);
    expect(r.state).toEqual({ count: 1, lastDayUtc: "2026-05-03" });
  });

  test("caps at MAX_STREAK (5) — already at 5, consecutive day stays at 5, +5 each day", () => {
    const r = claimDailyStreak(
      { count: MAX_STREAK, lastDayUtc: "2026-05-03" },
      new Date("2026-05-04T12:00:00Z"),
    );
    expect(r.grant!.streakAfter).toBe(MAX_STREAK);
    expect(r.grant!.bonusEnergy).toBe(MAX_STREAK);
    // reachedCap = false because we were ALREADY at cap before; the
    // "you climbed it!" celebration only fires once.
    expect(r.grant!.reachedCap).toBe(false);
  });

  test("reachedCap=true on the climb from 4 → 5", () => {
    const r = claimDailyStreak(
      { count: 4, lastDayUtc: "2026-05-03" },
      new Date("2026-05-04T12:00:00Z"),
    );
    expect(r.grant!.streakAfter).toBe(5);
    expect(r.grant!.reachedCap).toBe(true);
  });

  test("first-ever turn far in the future treats lastDayUtc=null as 'missed' → reset to 1", () => {
    const r = claimDailyStreak(
      { count: 0, lastDayUtc: null },
      new Date("2030-01-15T00:00:00Z"),
    );
    expect(r.grant!.streakAfter).toBe(1);
    expect(r.state.lastDayUtc).toBe("2030-01-15");
  });

  test("idempotent: claiming twice the same day returns identical state on the second call", () => {
    const start = { count: 0, lastDayUtc: null };
    const t = new Date("2026-05-03T12:00:00Z");
    const first = claimDailyStreak(start, t);
    expect(first.grant).not.toBeNull();
    const second = claimDailyStreak(first.state, t);
    expect(second.grant).toBeNull();
    expect(second.state).toEqual(first.state);
  });

  test("five-day climb: total grant = 1+2+3+4+5 = 15 energy", () => {
    let state = { count: 0, lastDayUtc: null as string | null };
    let total = 0;
    for (let i = 0; i < 5; i++) {
      const day = new Date(`2026-05-0${3 + i}T12:00:00Z`);
      const r = claimDailyStreak(state, day);
      expect(r.grant).not.toBeNull();
      total += r.grant!.bonusEnergy;
      state = r.state;
    }
    expect(state.count).toBe(MAX_STREAK);
    expect(total).toBe(15);
  });

  test("six-day climb: day 6 still yields +5 (capped, not +6)", () => {
    let state = { count: 0, lastDayUtc: null as string | null };
    let day6Bonus = 0;
    for (let i = 0; i < 6; i++) {
      const day = new Date(`2026-05-0${3 + i}T12:00:00Z`);
      const r = claimDailyStreak(state, day);
      if (i === 5) day6Bonus = r.grant!.bonusEnergy;
      state = r.state;
    }
    expect(day6Bonus).toBe(MAX_STREAK);
  });

  test("missed mid-climb resets and the next day becomes Day 1 again", () => {
    // Day 1, 2, 3 climb …
    let state = { count: 0, lastDayUtc: null as string | null };
    for (let i = 0; i < 3; i++) {
      const day = new Date(`2026-05-0${3 + i}T12:00:00Z`);
      state = claimDailyStreak(state, day).state;
    }
    expect(state.count).toBe(3);
    // … skip a day (no claim on the 6th) …
    // … claim again on the 7th. 2026-05-06 last; today 2026-05-07
    // is consecutive → would be 4. But pretend the user didn't show
    // up on 2026-05-06 either → lastDayUtc still 2026-05-05; 2 days
    // gap → reset.
    const r = claimDailyStreak(state, new Date("2026-05-07T12:00:00Z"));
    expect(r.grant!.streakBefore).toBe(3);
    expect(r.grant!.streakAfter).toBe(1);
  });
});
