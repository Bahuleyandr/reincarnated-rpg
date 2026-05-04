/**
 * Phase 5 Day 27: economy achievements + objectives evaluate
 * correctly against synthetic event slices.
 */
import {
  getAchievement,
  listAchievements,
} from "@/lib/achievements/catalog";
import { evaluate } from "@/lib/predicates/runner";
import type { Event } from "@/lib/game/types";

describe("economy achievement predicates", () => {
  test("first-trade fires on a single trade.completed event", () => {
    const a = getAchievement("first-trade");
    expect(a).not.toBeNull();
    const events: Event[] = [
      {
        kind: "trade.completed",
        npcId: "v1",
        action: "buy",
        itemId: "iron-ore",
        qty: 1,
        coinsDelta: -8,
      },
    ];
    expect(evaluate(a!.predicate, events).matched).toBe(true);
  });

  test("first-craft fires on a single craft.completed event", () => {
    const a = getAchievement("first-craft");
    const events: Event[] = [
      {
        kind: "craft.completed",
        recipeId: "smelt-iron-ingot",
        skill: "smelting",
        outputItemId: "iron-ingot",
        outputQty: 1,
      },
    ];
    expect(evaluate(a!.predicate, events).matched).toBe(true);
  });

  test("first-smith requires craft.completed with skill=smithing specifically", () => {
    const a = getAchievement("first-smith");
    const smelting: Event[] = [
      {
        kind: "craft.completed",
        recipeId: "smelt-iron-ingot",
        skill: "smelting",
        outputItemId: "iron-ingot",
        outputQty: 1,
      },
    ];
    expect(evaluate(a!.predicate, smelting).matched).toBe(false);
    const smithing: Event[] = [
      {
        kind: "craft.completed",
        recipeId: "smith-iron-knife",
        skill: "smithing",
        outputItemId: "small-knife",
        outputQty: 1,
      },
    ];
    expect(evaluate(a!.predicate, smithing).matched).toBe(true);
  });

  test("three-skills-learned counts skill.learned >= 3", () => {
    const a = getAchievement("three-skills-learned");
    const events: Event[] = [
      { kind: "skill.learned", skillId: "smithing", fromNpcId: "n1", fee: 100 },
      { kind: "skill.learned", skillId: "alchemy", fromNpcId: "n2", fee: 120 },
    ];
    expect(evaluate(a!.predicate, events).matched).toBe(false);
    const events3: Event[] = [
      ...events,
      { kind: "skill.learned", skillId: "cooking", fromNpcId: "n3", fee: 50 },
    ];
    expect(evaluate(a!.predicate, events3).matched).toBe(true);
  });

  test("skill-leveled-five fires on newLevel >= 5", () => {
    const a = getAchievement("skill-leveled-five");
    const lvl4: Event[] = [
      { kind: "skill.leveled_up", skillId: "smithing", newLevel: 4 },
    ];
    expect(evaluate(a!.predicate, lvl4).matched).toBe(false);
    const lvl5: Event[] = [
      { kind: "skill.leveled_up", skillId: "smithing", newLevel: 5 },
    ];
    expect(evaluate(a!.predicate, lvl5).matched).toBe(true);
  });

  test("ten-trades counts trade.completed >= 10", () => {
    const a = getAchievement("ten-trades");
    const make = (n: number): Event[] =>
      Array.from({ length: n }, () => ({
        kind: "trade.completed" as const,
        npcId: "v1",
        action: "buy" as const,
        itemId: "x",
        qty: 1,
        coinsDelta: -1,
      }));
    expect(evaluate(a!.predicate, make(9)).matched).toBe(false);
    expect(evaluate(a!.predicate, make(10)).matched).toBe(true);
  });

  test("fifty-gathered counts craft.gathered >= 50", () => {
    const a = getAchievement("fifty-gathered");
    const make = (n: number): Event[] =>
      Array.from({ length: n }, () => ({
        kind: "craft.gathered" as const,
        resourceId: "iron-ore",
        qty: 1,
        locationId: "iron-reach",
      }));
    expect(evaluate(a!.predicate, make(49)).matched).toBe(false);
    expect(evaluate(a!.predicate, make(50)).matched).toBe(true);
  });

  test("all economy achievements parse without errors (catalog import)", () => {
    const economyIds = [
      "first-trade",
      "first-gather",
      "first-craft",
      "first-smith",
      "first-skill-learned",
      "three-skills-learned",
      "skill-leveled-five",
      "skill-leveled-ten",
      "ten-trades",
      "ten-crafts",
      "fifty-gathered",
    ];
    const all = new Map(listAchievements().map((a) => [a.id, a]));
    for (const id of economyIds) {
      expect(all.has(id)).toBe(true);
      // The predicate is already parsed at catalog import time; just
      // ensure the entry is wired with relevantKinds.
      expect(all.get(id)!.relevantKinds.length).toBeGreaterThan(0);
    }
  });
});
