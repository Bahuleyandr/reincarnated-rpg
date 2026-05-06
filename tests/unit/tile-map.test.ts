/**
 * Tile-map loader + validator tests — POLISH_PLAN G.3b.
 *
 * Covers loadTileMap shape validation, and runs structural
 * checks against every authored tile-map in
 * `content/tile-maps/`:
 *   - the location id matches the filename
 *   - every grid character has a legend entry
 *   - every roomAnchor sits on a walkable tile
 *   - every roomAnchor's roomId actually exists in the location's
 *     content/locations/<id>.json rooms[]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  _resetTileMapCacheForTests,
  findOffWalkableAnchors,
  findUnknownTileChars,
  loadTileMap,
} from "@/lib/world/tile-map";

beforeEach(() => {
  _resetTileMapCacheForTests();
});

const TILE_MAP_DIR = join(process.cwd(), "content/tile-maps");

function authoredTileMapIds(): string[] {
  try {
    return readdirSync(TILE_MAP_DIR)
      .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

describe("tile-map loader", () => {
  test("returns null for an unknown location id (no JSON authored)", () => {
    expect(loadTileMap("nonexistent-place-xyz")).toBeNull();
  });

  test("loads collapsed-tunnel cleanly", () => {
    const map = loadTileMap("collapsed-tunnel");
    expect(map).not.toBeNull();
    expect(map!.locationId).toBe("collapsed-tunnel");
    expect(map!.grid.length).toBe(map!.height);
    expect(map!.grid[0].length).toBe(map!.width);
  });

  test("caches the result (second load returns same instance)", () => {
    const a = loadTileMap("collapsed-tunnel");
    const b = loadTileMap("collapsed-tunnel");
    expect(a).toBe(b);
  });

  test("invalidating the cache forces a re-read", () => {
    const a = loadTileMap("collapsed-tunnel");
    _resetTileMapCacheForTests();
    const b = loadTileMap("collapsed-tunnel");
    expect(a).not.toBe(b);
    expect(a).toEqual(b); // same data
  });
});

describe("authored tile-maps — structural integrity", () => {
  const ids = authoredTileMapIds();

  test("at least one tile-map authored", () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  for (const id of ids) {
    describe(id, () => {
      test("locationId matches the filename", () => {
        const map = loadTileMap(id)!;
        expect(map.locationId).toBe(id);
      });

      test("every grid character has a legend entry", () => {
        const map = loadTileMap(id)!;
        const unknown = findUnknownTileChars(map);
        expect([...unknown].sort()).toEqual([]);
      });

      test("every roomAnchor sits on a walkable tile", () => {
        const map = loadTileMap(id)!;
        const offending = findOffWalkableAnchors(map);
        expect(offending).toEqual([]);
      });

      test("every roomAnchor references a real room in content/locations/<id>.json", () => {
        const map = loadTileMap(id)!;
        const locPath = join(
          process.cwd(),
          "content/locations",
          `${id}.json`,
        );
        const loc = JSON.parse(readFileSync(locPath, "utf8")) as {
          rooms: Array<{ id: string }>;
        };
        const realRoomIds = new Set(loc.rooms.map((r) => r.id));
        const orphaned = Object.keys(map.roomAnchors).filter(
          (rid) => !realRoomIds.has(rid),
        );
        expect(orphaned).toEqual([]);
      });

      test("every authored room appears in roomAnchors (no missing rooms)", () => {
        const map = loadTileMap(id)!;
        const locPath = join(
          process.cwd(),
          "content/locations",
          `${id}.json`,
        );
        const loc = JSON.parse(readFileSync(locPath, "utf8")) as {
          rooms: Array<{ id: string }>;
        };
        const anchored = new Set(Object.keys(map.roomAnchors));
        const missing = loc.rooms
          .map((r) => r.id)
          .filter((rid) => !anchored.has(rid));
        expect(missing).toEqual([]);
      });
    });
  }
});
