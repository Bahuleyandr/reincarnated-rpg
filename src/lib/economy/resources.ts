/**
 * Resource catalog — Phase 5 Day 20.
 *
 * Pure module that exposes the resource items defined in
 * `content/items/resources.json`. Used by:
 *   - `gather_resource` tool (Day 21) to validate resourceId
 *   - vendor catalogs (any vendor selling a resource) for price floor
 *   - recipes (Day 22) for input/output validation
 *   - skills (Day 23-24) for displaying gather targets
 *
 * Slugs are kebab-case and match the existing add_inventory itemId
 * convention; resources flow through the same inventory + projection
 * path as all other items.
 */
import resourcesData from "../../../content/items/resources.json";

export interface ResourceItem {
  id: string;
  name: string;
  description: string;
  category: "resource";
  baseValue: number;
  rarity: "common" | "uncommon" | "rare" | "epic";
  tags: string[];
  /** Locations where this resource can be gathered. Empty for crafted
   *  outputs (ingots, planks) that don't grow in the wild. */
  sourceLocations: string[];
}

interface RawResource {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  category?: unknown;
  baseValue?: unknown;
  rarity?: unknown;
  tags?: unknown;
  sourceLocations?: unknown;
}

interface RawCatalog {
  items: RawResource[];
}

const VALID_RARITIES = new Set<ResourceItem["rarity"]>([
  "common",
  "uncommon",
  "rare",
  "epic",
]);

function normalize(raw: RawResource): ResourceItem | null {
  if (
    typeof raw.id !== "string" ||
    typeof raw.name !== "string" ||
    typeof raw.description !== "string" ||
    typeof raw.baseValue !== "number" ||
    typeof raw.rarity !== "string" ||
    !VALID_RARITIES.has(raw.rarity as ResourceItem["rarity"]) ||
    raw.category !== "resource"
  ) {
    return null;
  }
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    category: "resource",
    baseValue: Math.floor(raw.baseValue),
    rarity: raw.rarity as ResourceItem["rarity"],
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    sourceLocations: Array.isArray(raw.sourceLocations)
      ? (raw.sourceLocations as string[])
      : [],
  };
}

const CATALOG: ReadonlyArray<ResourceItem> = (resourcesData as unknown as RawCatalog).items
  .map(normalize)
  .filter((r): r is ResourceItem => r !== null);

const BY_ID = new Map<string, ResourceItem>(CATALOG.map((r) => [r.id, r]));

export function listResources(): readonly ResourceItem[] {
  return CATALOG;
}

export function getResource(id: string): ResourceItem | null {
  return BY_ID.get(id) ?? null;
}

/** True when the slug is a known resource (i.e., add_inventory'ing it
 *  would land a real catalog entry). Used by gather + recipe validators. */
export function isResource(id: string): boolean {
  return BY_ID.has(id);
}

/** All resource ids that can be gathered (have at least one
 *  sourceLocation). Crafted-only outputs like ingots have empty
 *  sourceLocations and don't appear here. */
export function listGatherableResources(): readonly ResourceItem[] {
  return CATALOG.filter((r) => r.sourceLocations.length > 0);
}

/** Resources whose sourceLocations include the given location id. */
export function listResourcesAtLocation(
  locationId: string,
): readonly ResourceItem[] {
  return CATALOG.filter((r) => r.sourceLocations.includes(locationId));
}
