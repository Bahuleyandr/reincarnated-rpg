/**
 * MapView builder + layout tests.
 */
import { buildMapView, layoutMapView } from "@/lib/game/map-view";
import type { LocationTemplate } from "@/lib/game/types";

function loc(
  rooms: Array<{ id: string; displayName?: string; exits?: string[] }>,
  entryRoomId?: string,
): LocationTemplate {
  return {
    id: "test-loc",
    entryRoomId: entryRoomId ?? rooms[0].id,
    rooms: rooms.map((r) => ({
      id: r.id,
      ...(r.displayName ? ({ displayName: r.displayName } as object) : {}),
      exits: (r.exits ?? []).map((to) => ({ verb: "go", toRoomId: to })),
    })) as LocationTemplate["rooms"],
  };
}

describe("buildMapView", () => {
  test("preserves displayName from JSON when present", () => {
    const v = buildMapView(
      loc([
        { id: "a", displayName: "Room A", exits: ["b"] },
        { id: "b", displayName: "Room B", exits: ["a"] },
      ]),
    );
    expect(v.rooms[0]).toMatchObject({ id: "a", displayName: "Room A" });
    expect(v.rooms[1]).toMatchObject({ id: "b", displayName: "Room B" });
  });

  test("omits displayName when JSON didn't specify it", () => {
    const v = buildMapView(loc([{ id: "a", exits: [] }]));
    expect(v.rooms[0].displayName).toBeUndefined();
  });

  test("deduplicates exit targets (rooms with multiple exit verbs to same neighbour)", () => {
    const tloc: LocationTemplate = {
      id: "t",
      entryRoomId: "a",
      rooms: [
        {
          id: "a",
          exits: [
            { verb: "go", toRoomId: "b" },
            { verb: "climb", toRoomId: "b" }, // two verbs to same neighbour
            { verb: "go", toRoomId: "c" },
          ],
        },
        { id: "b", exits: [] },
        { id: "c", exits: [] },
      ] as LocationTemplate["rooms"],
    };
    const v = buildMapView(tloc);
    expect(v.rooms[0].exits).toEqual(["b", "c"]);
  });

  test("threads entry + locationId through", () => {
    const v = buildMapView(
      loc([{ id: "a", exits: [] }, { id: "b", exits: [] }], "b"),
    );
    expect(v.locationId).toBe("test-loc");
    expect(v.entryRoomId).toBe("b");
  });
});

describe("layoutMapView", () => {
  test("empty rooms → empty positions map", () => {
    const positions = layoutMapView({
      locationId: "x",
      entryRoomId: "n/a",
      rooms: [],
    });
    expect(positions.size).toBe(0);
  });

  test("single room → centered", () => {
    const positions = layoutMapView({
      locationId: "x",
      entryRoomId: "only",
      rooms: [{ id: "only", exits: [] }],
    });
    expect(positions.get("only")).toEqual({ x: 50, y: 50 });
  });

  test("two rooms → horizontal pair (entry left)", () => {
    const positions = layoutMapView({
      locationId: "x",
      entryRoomId: "a",
      rooms: [
        { id: "a", exits: ["b"] },
        { id: "b", exits: ["a"] },
      ],
    });
    expect(positions.get("a")).toEqual({ x: 30, y: 50 });
    expect(positions.get("b")).toEqual({ x: 70, y: 50 });
  });

  test("three rooms → entry at center, two on a ring", () => {
    const positions = layoutMapView({
      locationId: "x",
      entryRoomId: "center",
      rooms: [
        { id: "center", exits: ["alpha", "beta"] },
        { id: "alpha", exits: ["center"] },
        { id: "beta", exits: ["center"] },
      ],
    });
    expect(positions.get("center")).toEqual({ x: 50, y: 50 });
    // 'alpha' < 'beta' alphabetically, so alpha is the first ring
    // entry — at the top of the circle.
    const alpha = positions.get("alpha")!;
    const beta = positions.get("beta")!;
    expect(alpha.y).toBeLessThan(50); // above center
    expect(beta.y).toBeGreaterThan(50); // below
    // Both on the ring (radius 32 in a 100×100 viewbox).
    const dAlpha = Math.hypot(alpha.x - 50, alpha.y - 50);
    const dBeta = Math.hypot(beta.x - 50, beta.y - 50);
    expect(Math.round(dAlpha)).toBe(32);
    expect(Math.round(dBeta)).toBe(32);
  });

  test("layout is deterministic regardless of JSON room order", () => {
    const a = layoutMapView({
      locationId: "x",
      entryRoomId: "center",
      rooms: [
        { id: "center", exits: [] },
        { id: "alpha", exits: [] },
        { id: "beta", exits: [] },
        { id: "gamma", exits: [] },
      ],
    });
    const b = layoutMapView({
      locationId: "x",
      entryRoomId: "center",
      // Same set, different order.
      rooms: [
        { id: "gamma", exits: [] },
        { id: "beta", exits: [] },
        { id: "alpha", exits: [] },
        { id: "center", exits: [] },
      ],
    });
    expect(b.get("alpha")).toEqual(a.get("alpha"));
    expect(b.get("beta")).toEqual(a.get("beta"));
    expect(b.get("gamma")).toEqual(a.get("gamma"));
    expect(b.get("center")).toEqual(a.get("center"));
  });
});
