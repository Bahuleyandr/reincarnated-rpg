/**
 * list_item tool — Phase 9 marketplace loop closure.
 *
 * The narrator emits this when the player explicitly says they're
 * listing an item for sale. The tool is multi-event:
 *   - inventory.removed (escrows the item out)
 *   - marketplace.listed (audit; the orchestrator side-effect
 *     mints the marketplace_listings row from this event)
 */
import { initialProjection } from "@/lib/game/projection";
import { validateToolsToEvents } from "@/lib/game/tools";
import type { FormTemplate, LocationTemplate, Projection } from "@/lib/game/types";

const FORM: FormTemplate = {
  id: "lesser-slime",
  vitals: {
    cohesion: { max: 8, start: 8, death: 0 },
    essence: { max: 5, start: 5 },
  },
  stats: { density: 1 },
  verbs: ["trade"],
};

const LOCATION: LocationTemplate = {
  id: "test-location",
  entryRoomId: "start",
  rooms: [{ id: "start", exits: [] }],
};

function projWithItem(qty: number): Projection {
  const base = initialProjection({
    sessionId: "00000000-0000-0000-0000-000000000000",
    form: FORM,
    location: LOCATION,
  });
  return {
    ...base,
    inventory: qty > 0 ? [{ itemId: "iron-ingot", qty }] : [],
  };
}

describe("list_item tool", () => {
  test("happy path: emits inventory.removed + marketplace.listed", () => {
    const projection = projWithItem(5);
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "list_item",
          itemId: "iron-ingot",
          qty: 2,
          pricePerUnit: 30,
          note: "warm to the touch",
        },
      ],
      form: FORM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      kind: "inventory.removed",
      itemId: "iron-ingot",
      qty: 2,
    });
    expect(result.events[1]).toMatchObject({
      kind: "marketplace.listed",
      itemId: "iron-ingot",
      qty: 2,
      pricePerUnit: 30,
      note: "warm to the touch",
    });
  });

  test("rejects when player doesn't hold enough", () => {
    const projection = projWithItem(1);
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "list_item",
          itemId: "iron-ingot",
          qty: 5,
          pricePerUnit: 30,
        },
      ],
      form: FORM,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.tool).toBe("list_item");
    expect(result.failure.error).toMatch(/only 1.*asked 5/);
  });

  test("rejects when player holds zero of the item", () => {
    const projection = projWithItem(0);
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "list_item",
          itemId: "iron-ingot",
          qty: 1,
          pricePerUnit: 30,
        },
      ],
      form: FORM,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/only 0/);
  });

  test("note defaults to null when omitted", () => {
    const projection = projWithItem(3);
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "list_item",
          itemId: "iron-ingot",
          qty: 1,
          pricePerUnit: 50,
        },
      ],
      form: FORM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const audit = result.events.find(
      (e): e is import("@/lib/game/types").Event & {
        kind: "marketplace.listed";
      } => e.kind === "marketplace.listed",
    );
    expect(audit?.note).toBeNull();
  });
});
