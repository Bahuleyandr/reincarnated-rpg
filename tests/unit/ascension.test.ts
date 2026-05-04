import {
  ASCENSION_RUN_THRESHOLD,
  ASCENSION_VARIETY_THRESHOLD,
  pickAscensionForm,
} from "@/lib/ascension/eligibility";

describe("pickAscensionForm", () => {
  test("smithing + rust_hand picks iron-hand-ascended", () => {
    expect(
      pickAscensionForm({
        factionId: "rust_hand",
        topSkillId: "smithing",
      }),
    ).toBe("iron-hand-ascended");
  });

  test("alchemy + choristers picks cantor-of-the-long-song", () => {
    expect(
      pickAscensionForm({
        factionId: "choristers",
        topSkillId: "alchemy",
      }),
    ).toBe("cantor-of-the-long-song");
  });

  test("falls back to the faction's default for unknown skill", () => {
    expect(
      pickAscensionForm({
        factionId: "rust_hand",
        topSkillId: "unicycling",
      }),
    ).toBe("rust-hand-ascendant");
  });

  test("idle players get the-still-one", () => {
    expect(
      pickAscensionForm({ factionId: "idle", topSkillId: null }),
    ).toBe("the-still-one");
  });

  test("forsaken default", () => {
    expect(
      pickAscensionForm({ factionId: "forsaken", topSkillId: null }),
    ).toBe("forsaken-revenant");
  });

  test("unknown faction falls to idle table", () => {
    expect(
      pickAscensionForm({ factionId: "made-up", topSkillId: null }),
    ).toBe("the-still-one");
  });
});

describe("ascension thresholds", () => {
  test("ASCENSION_RUN_THRESHOLD = 50", () => {
    expect(ASCENSION_RUN_THRESHOLD).toBe(50);
  });

  test("ASCENSION_VARIETY_THRESHOLD = 4", () => {
    expect(ASCENSION_VARIETY_THRESHOLD).toBe(4);
  });
});
