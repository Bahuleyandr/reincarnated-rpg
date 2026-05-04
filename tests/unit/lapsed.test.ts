import { classifyLapse } from "@/lib/engagement/lapsed";

const NOW = Date.parse("2026-05-04T12:00:00Z");

describe("classifyLapse", () => {
  test("active player (last turn within 7d) → null", () => {
    const lastTurn = NOW - 3 * 24 * 60 * 60 * 1000;
    expect(classifyLapse({ lastTurnAtMs: lastTurn, now: NOW })).toBeNull();
  });

  test("7-29 days → lapsed_7d", () => {
    const lastTurn = NOW - 10 * 24 * 60 * 60 * 1000;
    expect(classifyLapse({ lastTurnAtMs: lastTurn, now: NOW })).toBe(
      "lapsed_7d",
    );
  });

  test("30+ days → lapsed_30d", () => {
    const lastTurn = NOW - 35 * 24 * 60 * 60 * 1000;
    expect(classifyLapse({ lastTurnAtMs: lastTurn, now: NOW })).toBe(
      "lapsed_30d",
    );
  });

  test("isReturningToday wins over lapsed buckets", () => {
    expect(
      classifyLapse({
        lastTurnAtMs: NOW - 60 * 60 * 1000,
        isReturningToday: true,
        now: NOW,
      }),
    ).toBe("returning_welcome");
  });

  test("never-played user → null (not 'lapsed')", () => {
    expect(classifyLapse({ lastTurnAtMs: null, now: NOW })).toBeNull();
  });

  test("at exactly 7-day boundary → lapsed_7d", () => {
    expect(
      classifyLapse({
        lastTurnAtMs: NOW - 7 * 24 * 60 * 60 * 1000,
        now: NOW,
      }),
    ).toBe("lapsed_7d");
  });
});
