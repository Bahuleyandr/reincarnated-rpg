/**
 * GET /api/world/atlas — the regional graph + map + race summaries.
 * Public; cached by the CDN (no per-user state).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";

interface AtlasJson {
  metropolis: { id: string; displayName: string; tagline: string; shortName: string };
  spokes: Array<{
    direction: string;
    homeland: { id: string; displayName: string; race: string; biome: string };
    towns: Array<{ id: string; displayName: string; distanceFromCaelumDays: number }>;
  }>;
  asciiMap: string[];
  rivers: Array<{ name: string; summary: string }>;
}

interface RaceJson {
  id: string;
  displayName: string;
  homelandId: string;
  lifespanYears: { min: number; max: number; median: number };
  racialFeatures: Array<{ id: string; label: string; description: string }>;
  subPopulations: Array<{ id: string; label: string; summary: string; city: string }>;
}

interface LocationJson {
  id: string;
  displayName: string;
  tagline: string;
  rooms: unknown[];
  availableResources?: string[];
}

export async function GET() {
  const root = process.cwd();
  const atlasPath = join(root, "content", "world", "atlas.json");
  if (!existsSync(atlasPath)) {
    return NextResponse.json({ error: "atlas_missing" }, { status: 500 });
  }
  const atlas = JSON.parse(readFileSync(atlasPath, "utf8")) as AtlasJson;

  // Hydrate each homeland + town with displayName + tagline from
  // the location file (single source of truth — atlas only carries
  // ids + race + biome).
  function hydrate(id: string): {
    id: string;
    displayName: string;
    tagline: string;
    rooms: number;
    availableResources: string[];
  } {
    const path = join(root, "content", "locations", `${id}.json`);
    if (!existsSync(path)) {
      return {
        id,
        displayName: id,
        tagline: "",
        rooms: 0,
        availableResources: [],
      };
    }
    const loc = JSON.parse(readFileSync(path, "utf8")) as LocationJson;
    return {
      id: loc.id,
      displayName: loc.displayName,
      tagline: loc.tagline,
      rooms: Array.isArray(loc.rooms) ? loc.rooms.length : 0,
      availableResources: Array.isArray(loc.availableResources)
        ? loc.availableResources
        : [],
    };
  }

  // Race summaries.
  const racesDir = join(root, "content", "races");
  const races = existsSync(racesDir)
    ? readdirSync(racesDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const r = JSON.parse(
            readFileSync(join(racesDir, f), "utf8"),
          ) as RaceJson;
          return {
            id: r.id,
            displayName: r.displayName,
            homelandId: r.homelandId,
            lifespanMedian: r.lifespanYears?.median ?? null,
            racialFeatures: (r.racialFeatures ?? []).map((rf) => ({
              label: rf.label,
              description: rf.description,
            })),
            subPopulations: (r.subPopulations ?? []).map((sp) => ({
              id: sp.id,
              label: sp.label,
              summary: sp.summary,
            })),
          };
        })
    : [];

  return NextResponse.json({
    metropolis: hydrate(atlas.metropolis.id),
    metropolisShortName: atlas.metropolis.shortName,
    spokes: atlas.spokes.map((s) => ({
      direction: s.direction,
      biome: s.homeland.biome,
      homeland: hydrate(s.homeland.id),
      raceId: s.homeland.race,
      towns: s.towns.map((t) => hydrate(t.id)),
    })),
    asciiMap: atlas.asciiMap,
    rivers: atlas.rivers,
    races,
  });
}
