import {
  getResource,
  isResource,
  listGatherableResources,
  listResources,
  listResourcesAtLocation,
} from "@/lib/economy/resources";

describe("resource catalog", () => {
  test("loads at least 15 resources", () => {
    expect(listResources().length).toBeGreaterThanOrEqual(15);
  });

  test("ids are unique", () => {
    const ids = new Set(listResources().map((r) => r.id));
    expect(ids.size).toBe(listResources().length);
  });

  test("every entry has category=resource and a positive baseValue", () => {
    for (const r of listResources()) {
      expect(r.category).toBe("resource");
      expect(r.baseValue).toBeGreaterThan(0);
    }
  });

  test("rarity is one of the four valid bands", () => {
    const valid = new Set(["common", "uncommon", "rare", "epic"]);
    for (const r of listResources()) {
      expect(valid.has(r.rarity)).toBe(true);
    }
  });

  test("getResource returns a known + null for unknown", () => {
    expect(getResource("iron-ore")).not.toBeNull();
    expect(getResource("not-a-real-thing")).toBeNull();
  });

  test("isResource matches getResource", () => {
    expect(isResource("iron-ore")).toBe(true);
    expect(isResource("not-a-real-thing")).toBe(false);
  });

  test("listGatherableResources excludes crafted-only outputs (ingots, planks)", () => {
    const gather = listGatherableResources();
    const ids = new Set(gather.map((r) => r.id));
    // Raw resources are gatherable.
    expect(ids.has("iron-ore")).toBe(true);
    expect(ids.has("wood-oak")).toBe(true);
    // Crafted outputs are NOT gatherable (sourceLocations is empty).
    expect(ids.has("iron-ingot")).toBe(false);
    expect(ids.has("plank-oak")).toBe(false);
  });

  test("listResourcesAtLocation filters by location", () => {
    const ironReach = listResourcesAtLocation("iron-reach").map((r) => r.id);
    expect(ironReach).toContain("iron-ore");
    // Salt cathedral has salt blocks; iron reach does not.
    const saltCathedral = listResourcesAtLocation("salt-cathedral").map(
      (r) => r.id,
    );
    expect(saltCathedral).toContain("salt-block");
    expect(ironReach).not.toContain("salt-block");
  });

  test("returns [] for unknown locations", () => {
    expect(listResourcesAtLocation("not-a-place")).toEqual([]);
  });
});
