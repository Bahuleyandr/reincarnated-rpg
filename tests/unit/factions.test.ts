import {
  factionSkillBonus,
  FACTION_SKILL_BONUS,
  PLEDGE_COST_COINS,
} from "@/lib/story/factions";

describe("factionSkillBonus", () => {
  test("returns 1.0 when no faction pledged", () => {
    expect(factionSkillBonus({ factionId: null, skillId: "smithing" })).toBe(
      1,
    );
  });

  test("returns the bonus for an aligned skill", () => {
    expect(
      factionSkillBonus({ factionId: "rust_hand", skillId: "smithing" }),
    ).toBeCloseTo(FACTION_SKILL_BONUS, 5);
    expect(
      factionSkillBonus({ factionId: "choristers", skillId: "alchemy" }),
    ).toBeCloseTo(FACTION_SKILL_BONUS, 5);
  });

  test("returns 1.0 for an unaligned skill", () => {
    expect(
      factionSkillBonus({ factionId: "rust_hand", skillId: "alchemy" }),
    ).toBe(1);
  });

  test("idle faction never bonuses (refusal-as-discipline)", () => {
    expect(factionSkillBonus({ factionId: "idle", skillId: "smithing" })).toBe(
      1,
    );
    expect(factionSkillBonus({ factionId: "idle", skillId: "cooking" })).toBe(
      1,
    );
  });

  test("unknown faction → no bonus", () => {
    expect(
      factionSkillBonus({ factionId: "made_up_faction", skillId: "smithing" }),
    ).toBe(1);
  });
});

describe("constants", () => {
  test("PLEDGE_COST_COINS = 50", () => {
    expect(PLEDGE_COST_COINS).toBe(50);
  });

  test("FACTION_SKILL_BONUS = 1.10", () => {
    expect(FACTION_SKILL_BONUS).toBeCloseTo(1.1, 5);
  });
});
