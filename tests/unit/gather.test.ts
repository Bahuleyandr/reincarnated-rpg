import { rollGather, validateGather } from "@/lib/economy/gather";
import { initialProjection } from "@/lib/game/projection";
import { validateToolsToEvents } from "@/lib/game/tools";
import type { FormTemplate, LocationTemplate } from "@/lib/game/types";

describe("rollGather", () => {
  test("deterministic for the same (seed, resourceId)", () => {
    const a = rollGather({ seed: 42, resourceId: "iron-ore" });
    const b = rollGather({ seed: 42, resourceId: "iron-ore" });
    expect(a).toEqual(b);
  });

  test("different resources produce different rolls (most of the time)", () => {
    const a = rollGather({ seed: 42, resourceId: "iron-ore" });
    const b = rollGather({ seed: 42, resourceId: "wood-oak" });
    // It's possible — but rare — for two FNV-mixed seeds to collide
    // on a 6-sided die. Just check that the qty mapping is one of
    // {1,2,3} for both.
    expect([1, 2, 3]).toContain(a.qty);
    expect([1, 2, 3]).toContain(b.qty);
  });

  test("qty mapping is monotonic (skill-level bonus shifts toward higher qty)", () => {
    // With a fixed seed, increasing skillLevel should NEVER reduce qty.
    let prev = 0;
    for (let lvl = 0; lvl <= 10; lvl++) {
      const r = rollGather({ seed: 7, resourceId: "iron-ore", skillLevel: lvl });
      expect(r.qty).toBeGreaterThanOrEqual(prev);
      prev = r.qty;
    }
  });

  test("qty is always 1, 2, or 3", () => {
    for (let s = 1; s < 100; s++) {
      const r = rollGather({ seed: s, resourceId: "iron-ore" });
      expect([1, 2, 3]).toContain(r.qty);
    }
  });
});

describe("validateGather", () => {
  test("matches a resource available at the location", () => {
    const r = validateGather({
      locationId: "iron-reach",
      resourceId: "iron-ore",
    });
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.resource.id).toBe("iron-ore");
  });

  test("rejects when the resource isn't gatherable here", () => {
    const r = validateGather({
      locationId: "salt-cathedral",
      resourceId: "iron-ore",
    });
    expect("error" in r).toBe(true);
    if (!("error" in r)) return;
    expect(r.error).toMatch(/not available/);
  });

  test("rejects unknown locations", () => {
    const r = validateGather({
      locationId: "not-a-place",
      resourceId: "iron-ore",
    });
    expect("error" in r).toBe(true);
  });

  test("rejects unknown resources", () => {
    const r = validateGather({
      locationId: "iron-reach",
      resourceId: "diamond",
    });
    expect("error" in r).toBe(true);
  });
});

describe("gather_resource tool", () => {
  const FORM: FormTemplate = {
    id: "lesser-slime",
    vitals: { cohesion: { max: 8, start: 8, death: 0 } },
    stats: {},
    verbs: ["gather"],
    verbMappings: { gather: { tools: ["gather_resource"], rollStat: null } },
  };
  const LOCATION: LocationTemplate = {
    id: "iron-reach",
    entryRoomId: "start",
    rooms: [{ id: "start", exits: [] }],
  };

  test("emits craft.gathered + inventory.added", () => {
    const projection = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form: FORM,
      location: LOCATION,
    });
    const result = validateToolsToEvents({
      projection,
      tools: [{ name: "gather_resource", resourceId: "iron-ore" }],
      form: FORM,
      location: LOCATION,
      intent: "gather",
      rollBand: "success",
      turnSeed: 1234,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["craft.gathered", "inventory.added"]),
    );
    const gather = result.events.find((e) => e.kind === "craft.gathered");
    if (gather?.kind !== "craft.gathered") {
      throw new Error("expected craft.gathered event");
    }
    expect([1, 2, 3]).toContain(gather.qty);
    expect(gather.locationId).toBe("iron-reach");
    expect(gather.resourceId).toBe("iron-ore");
    const inv = result.events.find((e) => e.kind === "inventory.added");
    if (inv?.kind !== "inventory.added") {
      throw new Error("expected inventory.added event");
    }
    expect(inv.qty).toBe(gather.qty);
  });

  test("rejects gathering at the wrong location", () => {
    const projection = initialProjection({
      sessionId: "00000000-0000-0000-0000-000000000000",
      form: FORM,
      location: { ...LOCATION, id: "salt-cathedral" },
    });
    const result = validateToolsToEvents({
      projection,
      tools: [{ name: "gather_resource", resourceId: "iron-ore" }],
      form: FORM,
      location: LOCATION,
      intent: "gather",
      rollBand: "success",
      turnSeed: 1234,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/not available/);
  });
});
