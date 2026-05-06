/**
 * World-map tests — POLISH_PLAN G.3a.
 *
 * Verifies the atlas-driven layout puts each spoke in the right
 * compass direction, every authored location has a node, and the
 * spoke-edge graph reads as inside-out roads from caelum.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  _resetWorldMapCacheForTests,
  findWorldNode,
  getWorldMap,
} from "@/lib/world/world-map";

beforeEach(() => {
  _resetWorldMapCacheForTests();
});

function authoredLocationIds(): string[] {
  const dir = join(process.cwd(), "content/locations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

describe("world-map", () => {
  test("every authored location has a node", () => {
    const map = getWorldMap();
    const present = new Set(map.nodes.map((n) => n.locationId));
    const missing = authoredLocationIds().filter((id) => !present.has(id));
    expect(missing).toEqual([]);
  });

  test("caelum-by-the-wash sits near the center of the viewBox", () => {
    const map = getWorldMap();
    const caelum = findWorldNode(map, "caelum-by-the-wash");
    expect(caelum).not.toBeNull();
    expect(Math.abs(caelum!.x - 500)).toBeLessThan(20);
    expect(Math.abs(caelum!.y - 600)).toBeLessThan(40);
    expect(caelum!.biome).toBe("metropolis");
  });

  test("the dwarven north spoke is north of caelum", () => {
    const map = getWorldMap();
    const homeland = findWorldNode(map, "highfield-ascending")!;
    const town1 = findWorldNode(map, "three-notches")!;
    const town2 = findWorldNode(map, "coldspoon")!;
    expect(homeland.y).toBeLessThan(town2.y);
    expect(town2.y).toBeLessThan(town1.y);
    expect(town1.y).toBeLessThan(map.center.y);
    // All north-spoke towns share x ≈ caelum.x (vertical alignment).
    expect(Math.abs(homeland.x - map.center.x)).toBeLessThan(10);
  });

  test("the elven east spoke is east of caelum", () => {
    const map = getWorldMap();
    const saltgale = findWorldNode(map, "saltgale")!;
    const tallowfen = findWorldNode(map, "tallowfen")!;
    const mudmoth = findWorldNode(map, "mudmoth")!;
    expect(mudmoth.x).toBeGreaterThan(map.center.x);
    expect(tallowfen.x).toBeGreaterThan(mudmoth.x);
    expect(saltgale.x).toBeGreaterThan(tallowfen.x);
  });

  test("the orcish west spoke is west of caelum", () => {
    const map = getWorldMap();
    const indices = findWorldNode(map, "the-long-indices")!;
    const quietmile = findWorldNode(map, "quietmile")!;
    const cataract = findWorldNode(map, "cataract-mile")!;
    expect(cataract.x).toBeLessThan(map.center.x);
    expect(quietmile.x).toBeLessThan(cataract.x);
    expect(indices.x).toBeLessThan(quietmile.x);
  });

  test("the human SE spoke goes down-and-right", () => {
    const map = getWorldMap();
    const threadwarden = findWorldNode(map, "threadwarden")!;
    expect(threadwarden.x).toBeGreaterThan(map.center.x);
    expect(threadwarden.y).toBeGreaterThan(map.center.y);
  });

  test("the halfling SW spoke goes down-and-left", () => {
    const map = getWorldMap();
    const anchorage = findWorldNode(map, "the-coral-anchorage")!;
    expect(anchorage.x).toBeLessThan(map.center.x);
    expect(anchorage.y).toBeGreaterThan(map.center.y);
  });

  test("the 6 outer nodes are off-spoke wilderness", () => {
    const map = getWorldMap();
    const outerIds = [
      "collapsed-tunnel",
      "forsaken-village",
      "sunless-spire",
      "drowned-orchard",
      "hollow-market",
      "salt-cathedral",
    ];
    for (const id of outerIds) {
      const n = findWorldNode(map, id)!;
      expect(n.onSpoke).toBe(false);
      expect(n.biome).toBe("outer");
      expect(n.edgesTo).toEqual([]);
    }
  });

  test("spoke towns connect via edges back toward caelum (no orphans)", () => {
    const map = getWorldMap();
    const spokeNodes = map.nodes.filter(
      (n) => n.onSpoke && n.locationId !== "caelum-by-the-wash",
    );
    for (const n of spokeNodes) {
      // Every spoke node has exactly one incoming edge from the
      // previous town (or from caelum for the first town).
      expect(n.edgesTo.length).toBe(1);
      // The edge target must exist in the node set.
      const target = findWorldNode(map, n.edgesTo[0]);
      expect(target).not.toBeNull();
    }
  });

  test("all node coordinates fall inside the viewBox", () => {
    const map = getWorldMap();
    for (const n of map.nodes) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(map.viewBox.width);
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(map.viewBox.height);
    }
  });

  test("layout is deterministic across calls", () => {
    const a = getWorldMap();
    _resetWorldMapCacheForTests();
    const b = getWorldMap();
    expect(b.nodes.length).toBe(a.nodes.length);
    for (let i = 0; i < a.nodes.length; i++) {
      const ai = a.nodes[i];
      const bi = b.nodes[i];
      expect(bi.locationId).toBe(ai.locationId);
      expect(bi.x).toBe(ai.x);
      expect(bi.y).toBe(ai.y);
    }
  });
});
