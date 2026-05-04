import {
  getRecipe,
  listRecipes,
  listRecipesBySkill,
  validateRecipe,
} from "@/lib/economy/recipes";
import { initialProjection } from "@/lib/game/projection";
import { validateToolsToEvents } from "@/lib/game/tools";
import type { FormTemplate, LocationTemplate } from "@/lib/game/types";

describe("recipe catalog", () => {
  test("loads at least 10 recipes", () => {
    expect(listRecipes().length).toBeGreaterThanOrEqual(10);
  });
  test("ids are unique", () => {
    const ids = new Set(listRecipes().map((r) => r.id));
    expect(ids.size).toBe(listRecipes().length);
  });
  test("getRecipe + null fallback", () => {
    expect(getRecipe("smelt-iron-ingot")).not.toBeNull();
    expect(getRecipe("does-not-exist")).toBeNull();
  });
  test("listRecipesBySkill filters by skill", () => {
    const smithing = listRecipesBySkill("smithing");
    expect(smithing.length).toBeGreaterThanOrEqual(2);
    for (const r of smithing) expect(r.skill).toBe("smithing");
  });
  test("every recipe has at least one input + a positive xp + valid output qty", () => {
    for (const r of listRecipes()) {
      expect(r.inputs.length).toBeGreaterThan(0);
      expect(r.xp).toBeGreaterThanOrEqual(0);
      expect(r.output.qty).toBeGreaterThan(0);
    }
  });
});

describe("validateRecipe", () => {
  const inv = (items: Array<[string, number]>) =>
    items.map(([itemId, qty]) => ({ itemId, qty }));

  test("happy path with sufficient inputs", () => {
    const r = validateRecipe({
      recipeId: "smelt-iron-ingot",
      inventory: inv([
        ["iron-ore", 3],
        ["coal", 2],
      ]),
      locationId: "anywhere",
    });
    expect("error" in r).toBe(false);
  });

  test("missing input rejected", () => {
    const r = validateRecipe({
      recipeId: "smelt-iron-ingot",
      inventory: inv([["iron-ore", 1]]), // no coal
      locationId: "anywhere",
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/missing input/);
  });

  test("insufficient input qty rejected", () => {
    const r = validateRecipe({
      recipeId: "smelt-iron-ingot",
      inventory: inv([
        ["iron-ore", 1], // need 2
        ["coal", 1],
      ]),
      locationId: "anywhere",
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/missing input iron-ore/);
  });

  test("unknown recipe rejected", () => {
    const r = validateRecipe({
      recipeId: "nonsense",
      inventory: [],
      locationId: "anywhere",
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/unknown recipe/);
  });

  test("requiredLevel >= 2 blocks until skillLevels seeded", () => {
    // smelt-silver-ingot is requiredLevel 5.
    const r = validateRecipe({
      recipeId: "smelt-silver-ingot",
      inventory: inv([
        ["silver-ore", 2],
        ["coal", 2],
      ]),
      locationId: "anywhere",
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/level 5/);
  });

  test("skillLevels gate enforces level on full-skill mode", () => {
    const r = validateRecipe({
      recipeId: "smelt-silver-ingot",
      inventory: inv([
        ["silver-ore", 2],
        ["coal", 2],
      ]),
      locationId: "anywhere",
      skillLevels: { smelting: 3 },
    });
    expect("error" in r).toBe(true);

    const r2 = validateRecipe({
      recipeId: "smelt-silver-ingot",
      inventory: inv([
        ["silver-ore", 2],
        ["coal", 2],
      ]),
      locationId: "anywhere",
      skillLevels: { smelting: 5 },
    });
    expect("error" in r2).toBe(false);
  });

  test("level-1 recipe passes when skillLevels is undefined (Day 22 default)", () => {
    const r = validateRecipe({
      recipeId: "smelt-iron-ingot",
      inventory: inv([
        ["iron-ore", 2],
        ["coal", 1],
      ]),
      locationId: "anywhere",
    });
    expect("error" in r).toBe(false);
  });
});

describe("craft_recipe tool", () => {
  const FORM: FormTemplate = {
    id: "lesser-slime",
    vitals: { cohesion: { max: 8, start: 8, death: 0 } },
    stats: {},
    verbs: ["craft"],
    verbMappings: { craft: { tools: ["craft_recipe"], rollStat: null } },
  };
  const LOCATION: LocationTemplate = {
    id: "anywhere",
    entryRoomId: "start",
    rooms: [{ id: "start", exits: [] }],
  };

  function projWithInventory(items: Array<[string, number]>) {
    const base = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form: FORM,
      location: LOCATION,
    });
    return {
      ...base,
      inventory: items.map(([itemId, qty]) => ({ itemId, qty })),
    };
  }

  test("smelt-iron-ingot emits inventory.removed×2 + inventory.added + craft.completed + xp.granted", () => {
    const projection = projWithInventory([
      ["iron-ore", 3],
      ["coal", 2],
    ]);
    const result = validateToolsToEvents({
      projection,
      tools: [{ name: "craft_recipe", recipeId: "smelt-iron-ingot" }],
      form: FORM,
      location: LOCATION,
      intent: "craft",
      rollBand: "success",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = result.events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "inventory.removed")).toHaveLength(2);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "inventory.added",
        "craft.completed",
        "xp.granted",
      ]),
    );
    const xp = result.events.find((e) => e.kind === "xp.granted");
    if (xp?.kind !== "xp.granted") {
      throw new Error("expected xp.granted event");
    }
    expect(xp.amount).toBe(5);
    expect(xp.reason).toBe("skill:smelting");
  });

  test("rejects when input is missing", () => {
    const projection = projWithInventory([["iron-ore", 2]]); // no coal
    const result = validateToolsToEvents({
      projection,
      tools: [{ name: "craft_recipe", recipeId: "smelt-iron-ingot" }],
      form: FORM,
      location: LOCATION,
      intent: "craft",
      rollBand: "success",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/missing input coal/);
  });

  test("rejects when skill level too low", () => {
    const projection = projWithInventory([
      ["silver-ore", 2],
      ["coal", 2],
    ]);
    const result = validateToolsToEvents({
      projection,
      tools: [{ name: "craft_recipe", recipeId: "smelt-silver-ingot" }],
      form: FORM,
      location: LOCATION,
      intent: "craft",
      rollBand: "success",
      skillLevels: { smelting: 3 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/level 5/);
  });

  test("smith chain: ingot + handle → small-knife", () => {
    const projection = projWithInventory([
      ["iron-ingot", 1],
      ["wood-oak", 1],
    ]);
    const result = validateToolsToEvents({
      projection,
      tools: [{ name: "craft_recipe", recipeId: "smith-iron-knife" }],
      form: FORM,
      location: LOCATION,
      intent: "craft",
      rollBand: "success",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.events.find(
      (e) => e.kind === "craft.completed",
    );
    if (out?.kind !== "craft.completed") {
      throw new Error("expected craft.completed event");
    }
    expect(out.outputItemId).toBe("small-knife");
    expect(out.skill).toBe("smithing");
  });
});
