import {
  computeAdaptiveDifficulty,
  DEATH_STREAK_THRESHOLD,
  MAX_MODIFIER,
  type CampaignOutcome,
} from "@/lib/difficulty/adaptive";

function ended(reason: CampaignOutcome["reason"]): CampaignOutcome {
  return { reason, endedAt: new Date() };
}

describe("computeAdaptiveDifficulty", () => {
  test("zero campaigns → no bonus", () => {
    const r = computeAdaptiveDifficulty([]);
    expect(r.deathStreak).toBe(0);
    expect(r.modifier).toBe(0);
    expect(r.active).toBe(false);
  });

  test("one death → no bonus yet", () => {
    const r = computeAdaptiveDifficulty([ended("death")]);
    expect(r.deathStreak).toBe(1);
    expect(r.modifier).toBe(0);
  });

  test("two deaths → no bonus yet", () => {
    const r = computeAdaptiveDifficulty([ended("death"), ended("death")]);
    expect(r.deathStreak).toBe(2);
    expect(r.modifier).toBe(0);
  });

  test("three deaths → bonus active", () => {
    const r = computeAdaptiveDifficulty([
      ended("death"),
      ended("death"),
      ended("death"),
    ]);
    expect(r.deathStreak).toBe(3);
    expect(r.modifier).toBe(MAX_MODIFIER);
    expect(r.active).toBe(true);
  });

  test("five deaths → still capped at +1 (max modifier)", () => {
    const r = computeAdaptiveDifficulty([
      ended("death"),
      ended("death"),
      ended("death"),
      ended("death"),
      ended("death"),
    ]);
    expect(r.modifier).toBe(MAX_MODIFIER);
  });

  test("a win at the head resets the streak", () => {
    const r = computeAdaptiveDifficulty([
      ended("win"),
      ended("death"),
      ended("death"),
      ended("death"),
    ]);
    expect(r.deathStreak).toBe(0);
    expect(r.modifier).toBe(0);
  });

  test("a cap at the head resets the streak", () => {
    const r = computeAdaptiveDifficulty([ended("cap"), ended("death")]);
    expect(r.deathStreak).toBe(0);
  });

  test("death-then-win-then-deaths counts only the head deaths", () => {
    // Most-recent-first: [death, death, win, death, death]
    // → streak counts the leading 2 deaths, stops at the win.
    const r = computeAdaptiveDifficulty([
      ended("death"),
      ended("death"),
      ended("win"),
      ended("death"),
      ended("death"),
    ]);
    expect(r.deathStreak).toBe(2);
    expect(r.modifier).toBe(0);
  });

  test("unfinished campaigns at head break the count without reset", () => {
    const unfinished: CampaignOutcome = { reason: "death", endedAt: null };
    const r = computeAdaptiveDifficulty([
      unfinished,
      ended("death"),
      ended("death"),
      ended("death"),
    ]);
    expect(r.deathStreak).toBe(0);
  });

  test("DEATH_STREAK_THRESHOLD is 3 (matches the spec)", () => {
    expect(DEATH_STREAK_THRESHOLD).toBe(3);
  });

  test("MAX_MODIFIER is 1 (small softening, not trivializing)", () => {
    expect(MAX_MODIFIER).toBe(1);
  });
});
