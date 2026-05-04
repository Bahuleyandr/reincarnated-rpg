/**
 * Companion bond logic — pure-function tests for shouldBond +
 * buildPersonalityCard. The DB-side materializeBond + recall path
 * is exercised in the integration test (deferred).
 */
import {
  BOND_THRESHOLD,
  buildPersonalityCard,
  shouldBond,
} from "@/lib/companions/bond";
import { shouldRecallCompanions } from "@/lib/companions/recall";

describe("shouldBond", () => {
  test("matches at threshold (3)", () => {
    expect(shouldBond(BOND_THRESHOLD)).toBe(true);
  });
  test("misses below threshold", () => {
    expect(shouldBond(BOND_THRESHOLD - 1)).toBe(false);
    expect(shouldBond(0)).toBe(false);
    expect(shouldBond(-5)).toBe(false);
  });
  test("matches well above threshold", () => {
    expect(shouldBond(10)).toBe(true);
  });
});

describe("buildPersonalityCard", () => {
  const base = {
    npcId: "n1",
    npcName: "Kethra",
    slug: "kethra",
    formMet: "lesser-slime",
    timesHelped: 0,
    timesHarmed: 0,
    memorySummary: null,
  };

  test("warm voice when help dominates", () => {
    const card = buildPersonalityCard({
      ...base,
      timesHelped: 3,
      timesHarmed: 0,
    });
    expect(card.voice).toMatch(/warmly|owes you/i);
  });
  test("careful voice when harm dominates", () => {
    const card = buildPersonalityCard({
      ...base,
      timesHelped: 0,
      timesHarmed: 3,
    });
    expect(card.voice).toMatch(/carefully|knows what you can do/i);
  });
  test("even voice when balanced", () => {
    const card = buildPersonalityCard({
      ...base,
      timesHelped: 1,
      timesHarmed: 1,
    });
    expect(card.voice).toMatch(/evenly|recognition/i);
  });
  test("formMet preserved on the card", () => {
    expect(
      buildPersonalityCard({ ...base, formMet: "cursed-book" }).formMet,
    ).toBe("cursed-book");
  });
  test("mannerisms always at least 1", () => {
    const card = buildPersonalityCard(base);
    expect(card.mannerisms.length).toBeGreaterThanOrEqual(1);
  });
  test("mannerisms include a debt note when helped > 0", () => {
    const card = buildPersonalityCard({ ...base, timesHelped: 1 });
    expect(card.mannerisms.some((m) => /debt|owe/.test(m))).toBe(true);
  });
  test("mannerisms include a wariness note when harmed > 0", () => {
    const card = buildPersonalityCard({ ...base, timesHarmed: 1 });
    expect(card.mannerisms.some((m) => /knife|wary|hand near/.test(m))).toBe(true);
  });
  test("topicsOfInterest extracts from memorySummary when present", () => {
    const card = buildPersonalityCard({
      ...base,
      memorySummary: "Kethra lived in Iron-Reach. The Wyrm took her family.",
    });
    // Should extract some capitalized phrases.
    expect(card.topicsOfInterest.length).toBeGreaterThan(0);
  });
  test("topicsOfInterest falls back when no memorySummary", () => {
    const card = buildPersonalityCard({ ...base, memorySummary: null });
    expect(card.topicsOfInterest.length).toBeGreaterThan(0);
  });
  test("deterministic — same inputs produce same card", () => {
    const a = buildPersonalityCard({ ...base, timesHelped: 2 });
    const b = buildPersonalityCard({ ...base, timesHelped: 2 });
    expect(a).toEqual(b);
  });
});

describe("shouldRecallCompanions", () => {
  test("turn 0 + turn 1 trigger recall", () => {
    expect(shouldRecallCompanions(0)).toBe(true);
    expect(shouldRecallCompanions(1)).toBe(true);
  });
  test("turn 2+ does not", () => {
    expect(shouldRecallCompanions(2)).toBe(false);
    expect(shouldRecallCompanions(99)).toBe(false);
  });
});
