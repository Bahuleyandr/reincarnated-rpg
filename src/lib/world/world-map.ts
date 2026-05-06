/**
 * World-map positions — POLISH_PLAN G.3a Tier 3.
 *
 * Caelum-by-the-Wash sits at the center; five spokes radiate
 * outward (N: dwarves, E: elves, W: orcs, SE-fork: humans,
 * SW-fork: halflings). The atlas (`content/world/atlas.json`)
 * is the spatial source of truth. We derive the spoke layout
 * algorithmically (per-spoke compass direction × per-town
 * distance-from-caelum-days) so any new town authored along a
 * spoke flows in automatically.
 *
 * The 6 "outer" wilderness locations (collapsed-tunnel,
 * forsaken-village, sunless-spire, drowned-orchard, hollow-market,
 * salt-cathedral) sit outside the spoke graph — they are
 * dungeon / pre-civilization / abandoned places. Hand-placed
 * here at the periphery; not connected to spokes by drawn paths.
 *
 * Coordinates live in a 1000×1200 viewBox so the SVG renderer
 * can scale to whatever pixel size the page asks for.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface WorldNode {
  locationId: string;
  /** Display name (from atlas + JSON). */
  displayName: string;
  /** SVG x in 1000-unit viewBox. */
  x: number;
  /** SVG y in 1200-unit viewBox. */
  y: number;
  /** Spoke direction (N/E/W/SE/SW) or "metropolis" / "outer".
   *  Used to color the biome backdrop. */
  biome:
    | "metropolis"
    | "north" // dwarven highlands
    | "east" // elven mudflats
    | "west" // orcish plateau
    | "southeast" // human craft basin
    | "southwest" // halfling reef
    | "outer"; // wilderness / dungeon
  /** Whether this node is on a spoke (true) or off in the wilderness
   *  (false). Spokes draw connecting roads; outer nodes don't. */
  onSpoke: boolean;
  /** When set, an edge from THIS node to the named locationId is
   *  drawn on the map. Encoded one-way per node so the order in
   *  the array reflects the spoke's "outward" direction. */
  edgesTo: string[];
}

export interface WorldMap {
  nodes: WorldNode[];
  /** Center coordinates (caelum). Used by the renderer for the
   *  compass-rose marker and for drawing the spoke-junction. */
  center: { x: number; y: number };
  viewBox: { width: number; height: number };
}

interface AtlasJson {
  metropolis: { id: string; displayName: string };
  spokes: Array<{
    direction: "N" | "E" | "W" | "SE" | "SW" | string;
    homeland: { id: string; displayName: string; race: string };
    towns: Array<{
      id: string;
      displayName: string;
      distanceFromCaelumDays: number;
    }>;
  }>;
}

const VIEW_W = 1000;
const VIEW_H = 1200;
const CENTER = { x: 500, y: 600 };

/** Per-spoke compass angle (in radians, SVG-y-down). The
 *  per-spoke distance ramps as `100 * distanceFromCaelumDays + offset`. */
const SPOKE_ANGLES: Record<string, number> = {
  N: -Math.PI / 2, // straight up
  S: Math.PI / 2, // straight down
  E: 0, // right
  W: Math.PI, // left
  // The atlas has SE/SW as "south fork" — render them as forked
  // diagonals from caelum.
  SE: Math.PI * 0.42, // ~76° from horizontal, leaning right-down
  SW: Math.PI * 0.58, // ~76° from horizontal, leaning left-down
};

const SPOKE_BIOME: Record<string, WorldNode["biome"]> = {
  N: "north",
  E: "east",
  W: "west",
  SE: "southeast",
  SW: "southwest",
};

/**
 * Hand-placed wilderness nodes. Coordinates chosen so they don't
 * overlap any spoke and the layout reads as "outer ring of
 * unsanctioned places."
 */
const OUTER_NODES: Array<Omit<WorldNode, "onSpoke" | "edgesTo">> = [
  {
    locationId: "forsaken-village",
    displayName: "Forsaken Village",
    x: 180,
    y: 200,
    biome: "outer",
  },
  {
    locationId: "sunless-spire",
    displayName: "Sunless Spire",
    x: 820,
    y: 220,
    biome: "outer",
  },
  {
    locationId: "drowned-orchard",
    displayName: "Drowned Orchard",
    x: 840,
    y: 950,
    biome: "outer",
  },
  {
    locationId: "hollow-market",
    displayName: "Hollow Market",
    x: 180,
    y: 1050,
    biome: "outer",
  },
  {
    locationId: "collapsed-tunnel",
    displayName: "Collapsed Tunnel",
    x: 60,
    y: 700,
    biome: "outer",
  },
  {
    locationId: "salt-cathedral",
    displayName: "The Salt Cathedral",
    x: 950,
    y: 700,
    biome: "outer",
  },
];

let cached: WorldMap | null = null;

/** Build (and cache) the world-map node graph. Re-reads the atlas
 *  on first call; subsequent calls return the cached result. */
export function getWorldMap(): WorldMap {
  if (cached) return cached;
  cached = buildWorldMap();
  return cached;
}

/** Test-only — invalidates the cache so tests can stub the atlas. */
export function _resetWorldMapCacheForTests(): void {
  cached = null;
}

function buildWorldMap(): WorldMap {
  const atlas = readAtlas();
  const nodes: WorldNode[] = [];

  // Metropolis — anchor at the center.
  if (atlas) {
    nodes.push({
      locationId: atlas.metropolis.id,
      displayName: atlas.metropolis.displayName,
      x: CENTER.x,
      y: CENTER.y,
      biome: "metropolis",
      onSpoke: true,
      edgesTo: [], // edges are encoded outward from each spoke's first town
    });
  }

  // Spokes.
  if (atlas) {
    for (const spoke of atlas.spokes) {
      const angle = SPOKE_ANGLES[spoke.direction] ?? 0;
      const biome = SPOKE_BIOME[spoke.direction] ?? "outer";
      // Sort towns inward-to-outward by distance, so the line
      // connecting them reads as a road from caelum outward.
      const towns = [...spoke.towns].sort(
        (a, b) => a.distanceFromCaelumDays - b.distanceFromCaelumDays,
      );
      const ramp = 110; // SVG units per "day" of travel
      let prevId = atlas.metropolis.id;
      towns.forEach((town, i) => {
        const radius = ramp * town.distanceFromCaelumDays;
        const x = CENTER.x + Math.cos(angle) * radius;
        const y = CENTER.y + Math.sin(angle) * radius;
        nodes.push({
          locationId: town.id,
          displayName: town.displayName,
          x,
          y,
          biome,
          onSpoke: true,
          edgesTo: [prevId], // road back inward toward the previous town
        });
        prevId = town.id;
        void i;
      });
      // Homeland sits one ramp beyond the farthest town.
      const homelandDistance =
        (towns[towns.length - 1]?.distanceFromCaelumDays ?? 0) + 2;
      const homelandRadius = ramp * homelandDistance;
      const hx = CENTER.x + Math.cos(angle) * homelandRadius;
      const hy = CENTER.y + Math.sin(angle) * homelandRadius;
      nodes.push({
        locationId: spoke.homeland.id,
        displayName: spoke.homeland.displayName,
        x: hx,
        y: hy,
        biome,
        onSpoke: true,
        edgesTo: [prevId],
      });
    }
  }

  // Outer nodes — wilderness / dungeons.
  for (const o of OUTER_NODES) {
    nodes.push({
      ...o,
      onSpoke: false,
      edgesTo: [],
    });
  }

  // Clamp positions to the viewBox so a long spoke can never spill
  // off the canvas.
  for (const n of nodes) {
    n.x = Math.max(40, Math.min(VIEW_W - 40, n.x));
    n.y = Math.max(40, Math.min(VIEW_H - 40, n.y));
  }

  return {
    nodes,
    center: CENTER,
    viewBox: { width: VIEW_W, height: VIEW_H },
  };
}

function readAtlas(): AtlasJson | null {
  const path = join(process.cwd(), "content", "world", "atlas.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AtlasJson;
  } catch {
    return null;
  }
}

/** Convenience — find one node by id. */
export function findWorldNode(
  map: WorldMap,
  locationId: string,
): WorldNode | null {
  return map.nodes.find((n) => n.locationId === locationId) ?? null;
}
