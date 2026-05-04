import { summarizeCoinEvents } from "@/lib/economy/telemetry";
import type { Event } from "@/lib/game/types";

describe("summarizeCoinEvents", () => {
  test("groups coins.gained / coins.spent by source/sink tag", () => {
    const events: Event[] = [
      { kind: "coins.gained", amount: 36, source: "vendor:tutorial-vendor" },
      { kind: "coins.spent", amount: 80, sink: "trainer:old-vassi-of-the-furnace" },
      { kind: "coins.gained", amount: 10, source: "vendor:tutorial-vendor" },
    ];
    const out = summarizeCoinEvents(events);
    const byKey = Object.fromEntries(out.map((d) => [d.source, d]));
    expect(byKey["vendor:tutorial-vendor"].amount).toBe(46);
    expect(byKey["vendor:tutorial-vendor"].count).toBe(2);
    expect(byKey["trainer:old-vassi-of-the-furnace"].amount).toBe(-80);
    expect(byKey["trainer:old-vassi-of-the-furnace"].count).toBe(1);
  });

  test("ignores trade.completed (companion coins.* events drive telemetry)", () => {
    const events: Event[] = [
      {
        kind: "trade.completed",
        npcId: "v1",
        action: "sell",
        itemId: "x",
        qty: 1,
        coinsDelta: 12,
      },
    ];
    const out = summarizeCoinEvents(events);
    // No companion coins.gained → no entry.
    expect(out).toEqual([]);
  });

  test("returns [] for events with no coin impact", () => {
    const events: Event[] = [
      { kind: "turn.begun", turn: 1, input: "x", inputSanitized: "x" },
      { kind: "moved", fromRoom: "a", toRoom: "b" },
    ];
    expect(summarizeCoinEvents(events)).toEqual([]);
  });

  test("handles a real trade batch (gain + spent + audit)", () => {
    // What turn.ts produces for a single buy: trade.completed +
    // inventory.added + coins.spent.
    const events: Event[] = [
      {
        kind: "trade.completed",
        npcId: "v1",
        action: "buy",
        itemId: "iron-ore",
        qty: 2,
        coinsDelta: -16,
      },
      { kind: "inventory.added", itemId: "iron-ore", qty: 2 },
      { kind: "coins.spent", amount: 16, sink: "vendor:tutorial-vendor" },
    ];
    const out = summarizeCoinEvents(events);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      source: "vendor:tutorial-vendor",
      amount: -16,
      count: 1,
    });
  });
});
