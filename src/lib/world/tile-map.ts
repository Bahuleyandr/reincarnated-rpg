/**
 * Tile-map loader — POLISH_PLAN G.3b/G.3c.
 *
 * Reads `content/tile-maps/<locationId>.json` and returns a typed
 * TileMap. The schema:
 *
 *   - width × height ASCII grid (one row per string)
 *   - `legend` maps each character → { label, fill, glyph?, walkable }
 *   - `roomAnchors` maps each location-room id → tile (x, y) where
 *     the player avatar sits when standing in that room
 *
 * Returns null when no tile-map has been authored yet for the
 * location — the renderer falls back to the simpler MapPanel
 * graph view.
 *
 * The grid coordinates are tile units, NOT pixels. The renderer
 * scales to whatever pixel size the page asks for.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TileType {
  /** Display name (hover/tooltip). */
  label: string;
  /** Background fill color (CSS hex). */
  fill: string;
  /** Optional glyph rendered atop the fill (single character). */
  glyph?: string;
  /** Descriptive only — the room-exit graph in
   *  content/locations/<id>.json governs actual navigation. */
  walkable: boolean;
}

export interface TileMap {
  locationId: string;
  width: number;
  height: number;
  legend: Record<string, TileType>;
  /** ASCII grid: grid[y][x] is the tile char. Length = height;
   *  every string is exactly `width` chars long (validated). */
  grid: string[];
  /** Per-room avatar anchor — tile (x, y). */
  roomAnchors: Record<string, { x: number; y: number }>;
}

const cache = new Map<string, TileMap | null>();

export function loadTileMap(locationId: string): TileMap | null {
  if (cache.has(locationId)) return cache.get(locationId) ?? null;
  const path = join(
    process.cwd(),
    "content",
    "tile-maps",
    `${locationId}.json`,
  );
  if (!existsSync(path)) {
    cache.set(locationId, null);
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as TileMap;
    if (!validateTileMap(parsed)) {
      cache.set(locationId, null);
      return null;
    }
    cache.set(locationId, parsed);
    return parsed;
  } catch {
    cache.set(locationId, null);
    return null;
  }
}

/** Test-only — clears the cache so subsequent loadTileMap() calls
 *  re-read the JSON. */
export function _resetTileMapCacheForTests(): void {
  cache.clear();
}

/**
 * Strict-shape validation. We can't use Zod here because the
 * legend's keys are dynamic; do it by hand.
 */
function validateTileMap(m: unknown): m is TileMap {
  if (!m || typeof m !== "object") return false;
  const obj = m as Record<string, unknown>;
  if (typeof obj.locationId !== "string") return false;
  if (typeof obj.width !== "number" || obj.width <= 0) return false;
  if (typeof obj.height !== "number" || obj.height <= 0) return false;
  if (!obj.legend || typeof obj.legend !== "object") return false;
  if (!Array.isArray(obj.grid)) return false;
  if (obj.grid.length !== obj.height) return false;
  for (const row of obj.grid) {
    if (typeof row !== "string") return false;
    if (row.length !== obj.width) return false;
  }
  if (!obj.roomAnchors || typeof obj.roomAnchors !== "object") return false;
  return true;
}

/**
 * Verify every character in the grid has a legend entry. Returns
 * the set of unknown characters (empty when the map is consistent).
 * Used by tests + content:validate.
 */
export function findUnknownTileChars(m: TileMap): Set<string> {
  const known = new Set(Object.keys(m.legend));
  const unknown = new Set<string>();
  for (const row of m.grid) {
    for (const c of row) {
      if (!known.has(c)) unknown.add(c);
    }
  }
  return unknown;
}

/**
 * Verify every roomAnchor sits on a walkable tile. Returns the
 * room ids that anchor onto an unwalkable tile (mostly catches
 * authoring mistakes — e.g. an anchor placed inside a wall).
 */
export function findOffWalkableAnchors(m: TileMap): string[] {
  const offending: string[] = [];
  for (const [roomId, pos] of Object.entries(m.roomAnchors)) {
    if (pos.x < 0 || pos.x >= m.width) {
      offending.push(roomId);
      continue;
    }
    if (pos.y < 0 || pos.y >= m.height) {
      offending.push(roomId);
      continue;
    }
    const ch = m.grid[pos.y][pos.x];
    const tile = m.legend[ch];
    if (!tile?.walkable) offending.push(roomId);
  }
  return offending;
}
