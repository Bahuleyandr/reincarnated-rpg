/**
 * Player-as-NPC retirement (Roadmap 63) — pure-function tests.
 *
 * Integration coverage (DB writes + ascension hook + recurring
 * catalog merge) lives in tests/integration/retirement.test.ts.
 */
import { composeRetiredPersona } from "@/lib/retirement/retire";

describe("composeRetiredPersona", () => {
  test("includes display name + faction + run count + last words", () => {
    const fragment = composeRetiredPersona({
      displayName: "alex, the ascended",
      reason: "ascension",
      factionId: "choristers",
      topSkillId: "alchemy",
      topSkillLevel: 7,
      totalCampaigns: 60,
      distinctForms: 5,
      lastWords: "Tend the long song.",
    });
    expect(fragment).toContain("alex, the ascended");
    expect(fragment).toContain("choristers");
    expect(fragment).toContain("alchemy");
    expect(fragment).toContain("(lv 7)");
    expect(fragment).toContain("60 runs");
    expect(fragment).toContain("5 forms");
    expect(fragment).toContain("ascended out of the cycle");
    expect(fragment).toContain("Tend the long song.");
  });

  test("permadeath retirement reads as 'lost'", () => {
    const fragment = composeRetiredPersona({
      displayName: "noor, the lost",
      reason: "permadeath",
      factionId: null,
      topSkillId: null,
      topSkillLevel: 0,
      totalCampaigns: 12,
      distinctForms: 2,
      lastWords: null,
    });
    expect(fragment).toContain("lost to it");
    expect(fragment).not.toContain("ascended out");
    expect(fragment).not.toContain("Last words:");
  });

  test("life-tag scales by total campaigns", () => {
    const many = composeRetiredPersona({
      displayName: "x",
      reason: "ascension",
      factionId: null,
      topSkillId: null,
      topSkillLevel: 0,
      totalCampaigns: 80,
      distinctForms: 6,
      lastWords: null,
    });
    expect(many).toContain("lived many lives");

    const several = composeRetiredPersona({
      displayName: "y",
      reason: "ascension",
      factionId: null,
      topSkillId: null,
      topSkillLevel: 0,
      totalCampaigns: 25,
      distinctForms: 3,
      lastWords: null,
    });
    expect(several).toContain("lived several lives");

    const brief = composeRetiredPersona({
      displayName: "z",
      reason: "permadeath",
      factionId: null,
      topSkillId: null,
      topSkillLevel: 0,
      totalCampaigns: 4,
      distinctForms: 1,
      lastWords: null,
    });
    expect(brief).toContain("lived briefly");
  });
});
