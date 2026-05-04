/**
 * GET /api/world/locations/[id] — full location detail for the
 * /world/[id] page. Returns rooms, ambient pool, available
 * resources (with the registry's full descriptions), and the
 * regional flavor (race + sub-populations).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { regionFlavorFor } from "@/lib/world/regions";

interface LocationJson {
  id: string;
  displayName: string;
  tagline: string;
  ambientPool?: string[];
  entryRoomId: string;
  rooms: Array<{
    id: string;
    displayName: string;
    summary: string;
    ambientPool?: string[];
    exits?: Array<{ verb: string; toRoomId: string; narrative?: string }>;
  }>;
  availableResources?: string[];
}

interface ResourceJson {
  id: string;
  name: string;
  description: string;
  rarity: string;
  baseValue: number;
  tags: string[];
}

interface ResourcesCatalog {
  items: ResourceJson[];
}

let resourceCache: Map<string, ResourceJson> | null = null;
function loadResources(): Map<string, ResourceJson> {
  if (resourceCache) return resourceCache;
  const path = join(process.cwd(), "content", "items", "resources.json");
  if (!existsSync(path)) {
    resourceCache = new Map();
    return resourceCache;
  }
  const cat = JSON.parse(readFileSync(path, "utf8")) as ResourcesCatalog;
  resourceCache = new Map(cat.items.map((r) => [r.id, r]));
  return resourceCache;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const path = join(process.cwd(), "content", "locations", `${id}.json`);
  if (!existsSync(path)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const loc = JSON.parse(readFileSync(path, "utf8")) as LocationJson;
  const resources = loadResources();
  const region = regionFlavorFor(id);
  const hydratedResources = (loc.availableResources ?? [])
    .map((rid) => {
      const r = resources.get(rid);
      if (!r) return null;
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        rarity: r.rarity,
        baseValue: r.baseValue,
        tags: r.tags,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({
    id: loc.id,
    displayName: loc.displayName,
    tagline: loc.tagline,
    ambientPool: loc.ambientPool ?? [],
    entryRoomId: loc.entryRoomId,
    rooms: (loc.rooms ?? []).map((r) => ({
      id: r.id,
      displayName: r.displayName,
      summary: r.summary,
      ambientPool: r.ambientPool ?? [],
      exitCount: Array.isArray(r.exits) ? r.exits.length : 0,
    })),
    availableResources: hydratedResources,
    region: region
      ? {
          raceId: region.raceId,
          raceVoice: region.raceVoice,
          subPopulations: region.subPopulations,
        }
      : null,
  });
}
