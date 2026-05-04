import {
  getTutorialHint,
  TUTORIAL_HINTS,
  TUTORIAL_LENGTH,
} from "@/lib/tutorial/script";

describe("tutorial script", () => {
  test("has exactly TUTORIAL_LENGTH hints (3)", () => {
    expect(TUTORIAL_HINTS.length).toBe(TUTORIAL_LENGTH);
    expect(TUTORIAL_LENGTH).toBe(3);
  });

  test("hints cover turns 1, 2, 3", () => {
    for (let t = 1; t <= 3; t++) {
      const h = getTutorialHint(t);
      expect(h).not.toBeNull();
      expect(h!.turn).toBe(t);
      expect(h!.hint.length).toBeGreaterThan(5);
      expect(h!.example.length).toBeGreaterThan(2);
    }
  });

  test("turn 4+ returns null (graduation)", () => {
    expect(getTutorialHint(4)).toBeNull();
    expect(getTutorialHint(99)).toBeNull();
  });

  test("turn 0 / negative returns null", () => {
    expect(getTutorialHint(0)).toBeNull();
    expect(getTutorialHint(-1)).toBeNull();
  });

  test("examples reference slime-only verbs (form-distinctness)", () => {
    const allText = TUTORIAL_HINTS.map((h) => h.example).join(" ");
    // Each tutorial example uses a verb that the slime form has but
    // a typed cursed-book / dragon-egg does not.
    expect(/ooze|sense|absorb/.test(allText)).toBe(true);
  });
});
