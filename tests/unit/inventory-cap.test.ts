/**
 * Inventory capacity guardrail.
 * Spec:
 *   - 10 base slots
 *   - bag_slots from form.state stacks the capacity
 *   - hard cap at 30 even with all bonuses combined
 *   - add_inventory precondition rejects past capacity
 */
import {
  checkPrecondition,
  inventoryCapacity,
  inventoryUsed,
  SAFETY_CAPS,
} from "@/lib/game/tools";
import type { Projection, ToolCall } from "@/lib/game/types";

function fakeProjection(opts: {
  bagSlots?: number;
  inventory?: Array<{ itemId: string; qty: number }>;
}): Projection {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    upToSeq: 0,
    form: {
      id: "lesser-slime",
      vitals: { cohesion: 8, essence: 5 },
      vitalsMax: { cohesion: 8, essence: 5 },
      vitalsDeath: { cohesion: 0, essence: null },
      stats: { density: 1, viscosity: -1, awareness: 0, will: 0 },
      state: opts.bagSlots !== undefined ? { bag_slots: opts.bagSlots } : {},
    },
    location: { id: "x", roomId: "y", discovered: ["y"] },
    inventory: opts.inventory ?? [],
    npcs: {},
    quest: { id: null, objectives: {} },
    xp: 0,
    turn: 0,
    status: "active",
    reincarnatedAs: null,
  };
}

describe("inventoryCapacity", () => {
  test("base capacity is 10", () => {
    expect(inventoryCapacity(fakeProjection({}))).toBe(10);
  });

  test("bag_slots adds to capacity", () => {
    expect(inventoryCapacity(fakeProjection({ bagSlots: 5 }))).toBe(15);
  });

  test("hard cap at 30 regardless of stacking", () => {
    expect(inventoryCapacity(fakeProjection({ bagSlots: 50 }))).toBe(30);
    expect(inventoryCapacity(fakeProjection({ bagSlots: 999 }))).toBe(30);
  });

  test("never falls below base, even with negative bag_slots", () => {
    expect(inventoryCapacity(fakeProjection({ bagSlots: -10 }))).toBe(10);
  });

  test("SAFETY_CAPS exposes the magic numbers", () => {
    expect(SAFETY_CAPS.inventoryBase).toBe(10);
    expect(SAFETY_CAPS.inventoryHardMax).toBe(30);
  });
});

describe("inventoryUsed", () => {
  test("sums qty across all stacks", () => {
    const p = fakeProjection({
      inventory: [
        { itemId: "fish", qty: 3 },
        { itemId: "stone", qty: 2 },
      ],
    });
    expect(inventoryUsed(p)).toBe(5);
  });

  test("0 when empty", () => {
    expect(inventoryUsed(fakeProjection({}))).toBe(0);
  });
});

describe("add_inventory precondition", () => {
  test("allows when under capacity", () => {
    const p = fakeProjection({
      inventory: [{ itemId: "x", qty: 5 }],
    });
    const tool: ToolCall = {
      name: "add_inventory",
      itemId: "y",
      qty: 3,
    };
    expect(checkPrecondition(tool, p)).toBeNull();
  });

  test("allows exactly at capacity (used+qty == capacity)", () => {
    const p = fakeProjection({
      inventory: [{ itemId: "x", qty: 7 }],
    });
    const tool: ToolCall = {
      name: "add_inventory",
      itemId: "y",
      qty: 3,
    };
    expect(checkPrecondition(tool, p)).toBeNull();
  });

  test("rejects when adding would exceed capacity", () => {
    const p = fakeProjection({
      inventory: [{ itemId: "x", qty: 9 }],
    });
    const tool: ToolCall = {
      name: "add_inventory",
      itemId: "y",
      qty: 2,
    };
    const err = checkPrecondition(tool, p);
    expect(err).toMatch(/backpack full/i);
    expect(err).toMatch(/9\/10/);
  });

  test("hard cap holds even with maxed-out bag_slots", () => {
    // bag_slots boost takes capacity to 30 (hard max)
    const p = fakeProjection({
      bagSlots: 100,
      inventory: [{ itemId: "x", qty: 30 }],
    });
    const tool: ToolCall = {
      name: "add_inventory",
      itemId: "y",
      qty: 1,
    };
    const err = checkPrecondition(tool, p);
    expect(err).toMatch(/30\/30/);
  });
});
