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
  verbMappings: {
    trade: { tools: ["trade_with_npc"], rollStat: null },
  },
};

const LOCATION: LocationTemplate = {
  id: "test-location",
  entryRoomId: "start",
  rooms: [{ id: "start", exits: [] }],
};

function projWithVendor(coinsInScene = 0): Projection {
  const base = initialProjection({
    sessionId: "00000000-0000-0000-0000-000000000000",
    form: FORM,
    location: LOCATION,
  });
  return {
    ...base,
    npcs: {
      ...base.npcs,
      "tutorial-vendor-aabbccdd": {
        name: "Old Veft",
        relationship: 1,
        templateId: "tutorial-vendor",
      },
    },
    inventory: coinsInScene
      ? [{ itemId: "iron-ore", qty: 3 }]
      : [],
  };
}

describe("trade_with_npc tool", () => {
  test("buy emits trade.completed + inventory.added + coins.spent", () => {
    const projection = projWithVendor();
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "trade_with_npc",
          npcId: "tutorial-vendor-aabbccdd",
          action: "buy",
          itemId: "iron-ore",
          qty: 2,
        },
      ],
      form: FORM,
      location: LOCATION,
      intent: "trade",
      rollBand: "success",
      currentCoins: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "trade.completed",
        "inventory.added",
        "coins.spent",
      ]),
    );
    const trade = result.events.find((e) => e.kind === "trade.completed");
    expect(trade).toBeDefined();
    if (trade?.kind !== "trade.completed") return;
    expect(trade.coinsDelta).toBe(-16); // 8/unit × 2
    expect(trade.action).toBe("buy");
  });

  test("sell emits trade.completed + inventory.removed + coins.gained", () => {
    const projection = projWithVendor(1);
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "trade_with_npc",
          npcId: "tutorial-vendor-aabbccdd",
          action: "sell",
          itemId: "iron-ore",
          qty: 2,
        },
      ],
      form: FORM,
      location: LOCATION,
      intent: "trade",
      rollBand: "success",
      currentCoins: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "trade.completed",
        "inventory.removed",
        "coins.gained",
      ]),
    );
    const trade = result.events.find((e) => e.kind === "trade.completed");
    if (trade?.kind !== "trade.completed") {
      throw new Error("expected trade.completed event");
    }
    expect(trade.coinsDelta).toBe(10); // 5/unit × 2
    expect(trade.action).toBe("sell");
  });

  test("buy fails on insufficient coins", () => {
    const projection = projWithVendor();
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "trade_with_npc",
          npcId: "tutorial-vendor-aabbccdd",
          action: "buy",
          itemId: "iron-ore",
          qty: 2,
        },
      ],
      form: FORM,
      location: LOCATION,
      intent: "trade",
      rollBand: "success",
      currentCoins: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/insufficient coins/);
  });

  test("trade against unknown npc rejected", () => {
    const projection = projWithVendor();
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "trade_with_npc",
          npcId: "nope-12345678",
          action: "buy",
          itemId: "iron-ore",
          qty: 1,
        },
      ],
      form: FORM,
      location: LOCATION,
      intent: "trade",
      rollBand: "success",
      currentCoins: 100,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/unknown npc/);
  });

  test("sell with insufficient inventory rejected", () => {
    const projection = projWithVendor(); // no inventory
    const result = validateToolsToEvents({
      projection,
      tools: [
        {
          name: "trade_with_npc",
          npcId: "tutorial-vendor-aabbccdd",
          action: "sell",
          itemId: "iron-ore",
          qty: 1,
        },
      ],
      form: FORM,
      location: LOCATION,
      intent: "trade",
      rollBand: "success",
      currentCoins: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.error).toMatch(/inventory/);
  });
});
