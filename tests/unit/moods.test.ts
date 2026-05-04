import {
  isValidMood,
  moodPromptFragment,
  resolveMood,
} from "@/lib/narrator/moods";

describe("isValidMood", () => {
  test.each(["cozy", "standard", "brutal"])("accepts %s", (m) => {
    expect(isValidMood(m)).toBe(true);
  });
  test.each(["", "weird", null, undefined, 5, {}])(
    "rejects %p",
    (m) => {
      expect(isValidMood(m)).toBe(false);
    },
  );
});

describe("moodPromptFragment", () => {
  test("standard returns empty (no nudge needed)", () => {
    expect(moodPromptFragment("standard")).toBe("");
  });
  test("cozy returns a warmth nudge", () => {
    expect(moodPromptFragment("cozy")).toMatch(/warmth|kindness|recoverable/i);
  });
  test("brutal returns an indifferent-world nudge", () => {
    expect(moodPromptFragment("brutal")).toMatch(/indifferent|bite|cost/i);
  });
  test("null / undefined / unknown values fall back to empty", () => {
    expect(moodPromptFragment(null)).toBe("");
    expect(moodPromptFragment(undefined)).toBe("");
    expect(moodPromptFragment("weird")).toBe("");
  });
});

describe("resolveMood (session > user > standard)", () => {
  test("session mood wins", () => {
    expect(resolveMood("brutal", "cozy")).toBe("brutal");
  });
  test("user mood wins when session is null", () => {
    expect(resolveMood(null, "cozy")).toBe("cozy");
  });
  test("falls back to standard when both are null", () => {
    expect(resolveMood(null, null)).toBe("standard");
  });
  test("invalid session mood falls through to user", () => {
    expect(resolveMood("weird", "brutal")).toBe("brutal");
  });
  test("invalid user mood falls through to standard", () => {
    expect(resolveMood(null, "weird")).toBe("standard");
  });
});
