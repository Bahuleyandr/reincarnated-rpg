import {
  clearVendorCatalogCache,
  getVendorCatalog,
  validateTrade,
  type VendorCatalog,
} from "@/lib/economy/vendor";
import { netCoinDeltaFromEvents } from "@/lib/economy/coins";
import type { Event } from "@/lib/game/types";

describe("getVendorCatalog", () => {
  beforeEach(() => clearVendorCatalogCache());

  test("loads the tutorial vendor catalog from content/", () => {
    const c = getVendorCatalog("tutorial-vendor");
    expect(c).not.toBeNull();
    expect(c!.entries.length).toBeGreaterThan(0);
    // Central-bank invariant: sellPrice always strictly less than
    // buyPrice. Otherwise sell-buy-sell-buy gives free coins.
    for (const e of c!.entries) {
      expect(e.sellPrice).toBeLessThan(e.buyPrice);
    }
  });

  test("returns null for an NPC without metadata.catalog", () => {
    expect(getVendorCatalog("tunnel-rat")).toBeNull();
  });

  test("returns null for an unknown template id", () => {
    expect(getVendorCatalog("does-not-exist")).toBeNull();
  });
});

describe("validateTrade", () => {
  const catalog: VendorCatalog = {
    npcId: "v1",
    entries: [
      { itemId: "iron-ore", buyPrice: 10, sellPrice: 6 },
      { itemId: "rare-gem", buyPrice: 200, sellPrice: 120, stock: 1 },
    ],
  };

  test("buy succeeds with enough coins and unlimited stock", () => {
    const r = validateTrade({
      catalog,
      action: "buy",
      itemId: "iron-ore",
      qty: 2,
      currentCoins: 100,
      currentInventoryQty: 0,
    });
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.coinsDelta).toBe(-20);
    expect(r.totalPrice).toBe(20);
    expect(r.unitPrice).toBe(10);
  });

  test("buy fails on insufficient coins", () => {
    const r = validateTrade({
      catalog,
      action: "buy",
      itemId: "iron-ore",
      qty: 2,
      currentCoins: 5,
      currentInventoryQty: 0,
    });
    expect("error" in r).toBe(true);
    if (!("error" in r)) return;
    expect(r.error).toMatch(/insufficient coins/);
  });

  test("buy fails when out of stock", () => {
    const r = validateTrade({
      catalog,
      action: "buy",
      itemId: "rare-gem",
      qty: 2,
      currentCoins: 9999,
      currentInventoryQty: 0,
    });
    expect("error" in r).toBe(true);
    if (!("error" in r)) return;
    expect(r.error).toMatch(/in stock/);
  });

  test("sell succeeds when player holds the item", () => {
    const r = validateTrade({
      catalog,
      action: "sell",
      itemId: "iron-ore",
      qty: 3,
      currentCoins: 0,
      currentInventoryQty: 5,
    });
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.coinsDelta).toBe(18); // 3 × 6
    expect(r.totalPrice).toBe(18);
  });

  test("sell fails when player doesn't have enough of the item", () => {
    const r = validateTrade({
      catalog,
      action: "sell",
      itemId: "iron-ore",
      qty: 3,
      currentCoins: 0,
      currentInventoryQty: 1,
    });
    expect("error" in r).toBe(true);
    if (!("error" in r)) return;
    expect(r.error).toMatch(/inventory/);
  });

  test("trade fails when itemId is not in catalog", () => {
    const r = validateTrade({
      catalog,
      action: "buy",
      itemId: "diamond",
      qty: 1,
      currentCoins: 9999,
      currentInventoryQty: 0,
    });
    expect("error" in r).toBe(true);
    if (!("error" in r)) return;
    expect(r.error).toMatch(/doesn't deal in/);
  });

  test("qty must be 1-10", () => {
    const r1 = validateTrade({
      catalog,
      action: "buy",
      itemId: "iron-ore",
      qty: 0,
      currentCoins: 100,
      currentInventoryQty: 0,
    });
    expect("error" in r1).toBe(true);

    const r2 = validateTrade({
      catalog,
      action: "buy",
      itemId: "iron-ore",
      qty: 11,
      currentCoins: 9999,
      currentInventoryQty: 0,
    });
    expect("error" in r2).toBe(true);
  });
});

describe("netCoinDeltaFromEvents", () => {
  test("sums coins.gained, coins.spent, and trade.completed deltas", () => {
    const events: Event[] = [
      { kind: "coins.gained", amount: 50, source: "test" },
      { kind: "coins.spent", amount: 12, sink: "test" },
      {
        kind: "trade.completed",
        npcId: "v1",
        action: "buy",
        itemId: "x",
        qty: 1,
        coinsDelta: -8,
      },
      { kind: "turn.begun", turn: 1, input: "x", inputSanitized: "x" },
    ];
    expect(netCoinDeltaFromEvents(events)).toBe(50 - 12 - 8);
  });

  test("returns 0 when no coin events", () => {
    const events: Event[] = [
      { kind: "turn.begun", turn: 1, input: "x", inputSanitized: "x" },
      { kind: "moved", fromRoom: "a", toRoom: "b" },
    ];
    expect(netCoinDeltaFromEvents(events)).toBe(0);
  });

  test("trade.completed with sell action contributes positive delta", () => {
    const events: Event[] = [
      {
        kind: "trade.completed",
        npcId: "v1",
        action: "sell",
        itemId: "x",
        qty: 2,
        coinsDelta: +30,
      },
    ];
    expect(netCoinDeltaFromEvents(events)).toBe(30);
  });
});
