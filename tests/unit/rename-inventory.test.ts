import { applyEvents, initialProjection } from "@/lib/game/projection";
import { validateToolsToEvents } from "@/lib/game/tools";
import type { Event, FormTemplate, LocationTemplate } from "@/lib/game/types";

const FORM: FormTemplate = {
  id: "lesser-slime",
  vitals: { cohesion: { max: 8, start: 8, death: 0 } },
  stats: {},
  verbs: ["name"],
  verbMappings: {
    name: { tools: ["rename_inventory"], rollStat: null },
  },
};
const LOC: LocationTemplate = {
  id: "anywhere",
  entryRoomId: "x",
  rooms: [{ id: "x", exits: [] }],
};

function projWithItem(itemId: string, qty: number) {
  const base = initialProjection({
    sessionId: "00000000-0000-0000-0000-000000000000",
    form: FORM,
    location: LOC,
  });
  return applyEvents(base, [
    { kind: "inventory.added", itemId, qty },
  ] as Event[]);
}

describe("rename_inventory tool", () => {
  test("emits inventory.renamed for a held item", () => {
    const projection = projWithItem("rusted-dagger", 1);
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "rename_inventory",
          itemId: "rusted-dagger",
          customName: "Marrow",
        },
      ],
      form: FORM,
      location: LOC,
      intent: "name",
      rollBand: "success",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([
      {
        kind: "inventory.renamed",
        itemId: "rusted-dagger",
        customName: "Marrow",
      },
    ]);
  });

  test("rejects when item is not held", () => {
    const projection = projWithItem("rusted-dagger", 1);
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "rename_inventory",
          itemId: "iron-ingot",
          customName: "X",
        },
      ],
      form: FORM,
      location: LOC,
      intent: "name",
      rollBand: "success",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/item not held/);
  });

  test("rejects pure whitespace", () => {
    const projection = projWithItem("rusted-dagger", 1);
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "rename_inventory",
          itemId: "rusted-dagger",
          customName: "   ",
        },
      ],
      form: FORM,
      location: LOC,
      intent: "name",
      rollBand: "success",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/empty/);
  });

  test("rejects control characters", () => {
    const projection = projWithItem("rusted-dagger", 1);
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "rename_inventory",
          itemId: "rusted-dagger",
          customName: "Marrow\x07",
        },
      ],
      form: FORM,
      location: LOC,
      intent: "name",
      rollBand: "success",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/control characters/);
  });

  test("name max 32 chars enforced by zod schema", () => {
    const projection = projWithItem("rusted-dagger", 1);
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "rename_inventory",
          itemId: "rusted-dagger",
          customName: "x".repeat(33),
        },
      ],
      form: FORM,
      location: LOC,
      intent: "name",
      rollBand: "success",
    });
    expect(result.ok).toBe(false);
  });

  test("projection reducer applies the custom name", () => {
    let projection = projWithItem("rusted-dagger", 2);
    projection = applyEvents(projection, [
      {
        kind: "inventory.renamed",
        itemId: "rusted-dagger",
        customName: "Marrow",
      },
    ] as Event[]);
    const slot = projection.inventory.find((i) => i.itemId === "rusted-dagger");
    expect(slot?.customName).toBe("Marrow");
    expect(slot?.qty).toBe(2);
  });

  test("renaming an item not in inventory is a defensive no-op", () => {
    let projection = projWithItem("rusted-dagger", 1);
    projection = applyEvents(projection, [
      {
        kind: "inventory.renamed",
        itemId: "ghost-item",
        customName: "X",
      },
    ] as Event[]);
    expect(
      projection.inventory.find((i) => i.itemId === "ghost-item"),
    ).toBeUndefined();
  });

  test("trims whitespace around the custom name", () => {
    const projection = projWithItem("rusted-dagger", 1);
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "rename_inventory",
          itemId: "rusted-dagger",
          customName: "  Marrow  ",
        },
      ],
      form: FORM,
      location: LOC,
      intent: "name",
      rollBand: "success",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]).toMatchObject({ customName: "Marrow" });
  });
});
