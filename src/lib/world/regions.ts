/**
 * Region resolver — Phase 9 atlas integration.
 *
 * Reads content/world/atlas.json + content/races/*.json at module
 * boot to build a (locationId → race + voice + sub-populations +
 * signature resources) lookup. Used by the turn orchestrator to
 * inject regional flavor into the RemoteNarrator's regionFlavor
 * block.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface RegionFlavor {
  locationId: string;
  raceId: string | null;
  raceVoice: string | null;
  subPopulations: string[];
  signatureResources: string[];
}

interface AtlasJson {
  metropolis: { id: string; displayName: string; shortName: string };
  spokes: Array<{
    direction: string;
    homeland: { id: string; displayName: string; race: string };
    towns: Array<{ id: string; displayName: string; distanceFromCaelumDays: number }>;
  }>;
}

interface RaceJson {
  id: string;
  homelandId: string;
  voice: string;
  subPopulations: Array<{ id: string; label: string; city: string }>;
}

interface LocationJson {
  id: string;
  availableResources?: string[];
}

interface ResolvedRegion {
  raceId: string | null;
  raceVoice: string | null;
  subPopulations: string[];
}

let cached: Map<string, RegionFlavor> | null = null;

function buildCache(): Map<string, RegionFlavor> {
  const root = process.cwd();
  const map = new Map<string, RegionFlavor>();

  // Atlas drives location → race association via the spoke graph.
  const atlasPath = join(root, "content", "world", "atlas.json");
  let atlas: AtlasJson | null = null;
  if (existsSync(atlasPath)) {
    atlas = JSON.parse(readFileSync(atlasPath, "utf8")) as AtlasJson;
  }

  // Race files give the voice + sub-populations.
  const racesDir = join(root, "content", "races");
  const racesByHomeland = new Map<string, ResolvedRegion>();
  const racesById = new Map<string, ResolvedRegion>();
  if (existsSync(racesDir)) {
    for (const file of readdirSync(racesDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const r = JSON.parse(
          readFileSync(join(racesDir, file), "utf8"),
        ) as RaceJson & { homelandId?: string };
        const region: ResolvedRegion = {
          raceId: r.id,
          raceVoice: r.voice ?? null,
          subPopulations: (r.subPopulations ?? []).map((s) => s.label),
        };
        racesById.set(r.id, region);
        if (r.homelandId) racesByHomeland.set(r.homelandId, region);
      } catch {
        // skip malformed
      }
    }
  }

  if (!atlas) return map;

  // Metropolis: every race; pick a "mixed" voice.
  const metropolisRegion: RegionFlavor = {
    locationId: atlas.metropolis.id,
    raceId: "mixed",
    raceVoice:
      "five-way pidgin in cargo zones; per-race voice elsewhere — match whoever the player is interacting with.",
    subPopulations: Array.from(racesById.values()).flatMap(
      (r) => r.subPopulations,
    ),
    signatureResources: signatureResourcesFor(atlas.metropolis.id),
  };
  map.set(atlas.metropolis.id, metropolisRegion);

  for (const spoke of atlas.spokes) {
    const homeland = spoke.homeland;
    const race =
      racesByHomeland.get(homeland.id) ??
      racesById.get(homeland.race.replace(/^the\s+/, "")) ??
      racesById.get(homeland.race);
    const homelandFlavor: RegionFlavor = {
      locationId: homeland.id,
      raceId: race?.raceId ?? null,
      raceVoice: race?.raceVoice ?? null,
      subPopulations: race?.subPopulations ?? [],
      signatureResources: signatureResourcesFor(homeland.id),
    };
    map.set(homeland.id, homelandFlavor);

    // Towns inherit the spoke's race for voice, but their own
    // signature resources.
    for (const town of spoke.towns) {
      map.set(town.id, {
        locationId: town.id,
        raceId: race?.raceId ?? null,
        raceVoice: race?.raceVoice ?? null,
        subPopulations: race?.subPopulations ?? [],
        signatureResources: signatureResourcesFor(town.id),
      });
    }
  }

  return map;
}

function signatureResourcesFor(locationId: string): string[] {
  const path = join(
    process.cwd(),
    "content",
    "locations",
    `${locationId}.json`,
  );
  if (!existsSync(path)) return [];
  try {
    const loc = JSON.parse(readFileSync(path, "utf8")) as LocationJson;
    return Array.isArray(loc.availableResources)
      ? loc.availableResources.slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

/**
 * Returns the regional flavor for a locationId, or null if the
 * location is not part of the Phase-9 atlas (e.g. the original
 * collapsed-tunnel, sunless-spire, etc — those play race-agnostic).
 */
export function regionFlavorFor(locationId: string): RegionFlavor | null {
  if (!cached) cached = buildCache();
  return cached.get(locationId) ?? null;
}

/** Test/dev — reset the module cache so a content edit is picked up. */
export function _resetRegionCacheForTests(): void {
  cached = null;
}
