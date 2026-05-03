/**
 * pickFormId — keyword routing from a free-text reincarnation
 * declaration to a typed form id (or generic-creature fallback).
 */
import { pickFormId } from "@/lib/game/types";

describe("pickFormId", () => {
  it("defaults to lesser-slime when nothing is declared", () => {
    expect(pickFormId(null)).toBe("lesser-slime");
    expect(pickFormId(undefined)).toBe("lesser-slime");
    expect(pickFormId("")).toBe("lesser-slime");
  });

  it("routes slime/ooze/jelly/gel to lesser-slime", () => {
    expect(pickFormId("a lesser slime")).toBe("lesser-slime");
    expect(pickFormId("an acid slime")).toBe("lesser-slime");
    expect(pickFormId("a green ooze")).toBe("lesser-slime");
    expect(pickFormId("a wet jelly creature")).toBe("lesser-slime");
    expect(pickFormId("a sentient gel")).toBe("lesser-slime");
  });

  it("routes book/tome/grimoire/codex/journal to cursed-book", () => {
    expect(pickFormId("a cursed book")).toBe("cursed-book");
    expect(pickFormId("the tome of unspoken names")).toBe("cursed-book");
    expect(pickFormId("a grimoire of forgotten things")).toBe("cursed-book");
    expect(pickFormId("a stolen codex")).toBe("cursed-book");
    expect(pickFormId("an old journal")).toBe("cursed-book");
  });

  it("routes dragon-egg variants ahead of bare 'egg'", () => {
    expect(pickFormId("a dragon egg, still warm")).toBe("dragon-egg");
    expect(pickFormId("an egg of an old dragon")).toBe("dragon-egg");
    expect(pickFormId("a wyrmling egg")).toBe("dragon-egg");
    // bare "egg" with no dragon → generic
    expect(pickFormId("an egg")).toBe("generic-creature");
  });

  it("routes dungeon core/heart/crystal to dungeon-core", () => {
    expect(pickFormId("a dungeon core newly awakened")).toBe("dungeon-core");
    expect(pickFormId("the dungeon-core")).toBe("dungeon-core");
    expect(pickFormId("a dungeon heart")).toBe("dungeon-core");
    expect(pickFormId("a dungeon crystal")).toBe("dungeon-core");
    // just "dungeon" alone → generic
    expect(pickFormId("a dungeon")).toBe("generic-creature");
  });

  it("falls back to generic-creature for absurd or unknown declarations", () => {
    expect(pickFormId("a vending machine")).toBe("generic-creature");
    expect(pickFormId("a fork")).toBe("generic-creature");
    expect(pickFormId("a wooden signpost")).toBe("generic-creature");
    expect(pickFormId("a cartographer's ghost")).toBe("generic-creature");
    expect(pickFormId("a coin that has changed hands too many times")).toBe(
      "generic-creature",
    );
  });

  it("specific patterns win over less specific ones", () => {
    // "dragon egg" should NOT pick up a hypothetical broader "egg"
    // route because the dragon-egg pattern fires first.
    expect(pickFormId("a dragon egg in a stolen codex")).toBe("dragon-egg");
  });
});
