/**
 * Gather resolution — pure helpers for the `gather_resource` tool.
 *
 * Quantity is rolled from a deterministic per-turn seed so a
 * replay-from-zero produces the same gather outcome. The roll is a
 * 2d6 mapped to 1-3 of the resource:
 *
 *   2-5  → 1 (light find)
 *   6-9  → 2 (decent find)
 *   10-12 → 3 (rich vein)
 *
 * Skills (Phase 5 Day 23-24) layer onto this by adding a flat bonus
 * to the 2d6 sum before mapping. With smithing/mining level 5+ the
 * curve shifts toward 2 and 3.
 *
 * Phase 5 Day 21.
 */
import { mulberry32 } from "../util/rng";

import { listResourcesAtLocation, type ResourceItem } from "./resources";

export interface GatherInputs {
  /** Per-turn seed mixed with the resource id — derived from
   *  (sessionSeed ^ turnNumber) by the orchestrator. */
  seed: number;
  resourceId: string;
  /** Skill level (0+) — adds to the 2d6 sum before mapping. Default 0. */
  skillLevel?: number;
}

export interface GatherOutcome {
  qty: number;
  /** The two dice the server rolled, for audit/UI. */
  d1: number;
  d2: number;
  /** Sum after skill modifier. */
  total: number;
}

const RESOURCE_SEED_OFFSET = 0xa1b2c3d4;

/** Pure: roll the gather quantity. Deterministic for a given (seed, resourceId, skillLevel). */
export function rollGather(inputs: GatherInputs): GatherOutcome {
  // Mix the resourceId hash into the seed so two gathers of different
  // resources in the same turn don't yield identical rolls.
  const idHash = simpleStringHash(inputs.resourceId);
  const seed = (inputs.seed ^ idHash ^ RESOURCE_SEED_OFFSET) >>> 0;
  const rng = mulberry32(seed);
  const d1 = 1 + Math.floor(rng() * 6);
  const d2 = 1 + Math.floor(rng() * 6);
  const total = d1 + d2 + (inputs.skillLevel ?? 0);
  let qty = 1;
  if (total >= 10) qty = 3;
  else if (total >= 6) qty = 2;
  return { qty, d1, d2, total };
}

function simpleStringHash(s: string): number {
  // 32-bit FNV-1a — good enough for seed mixing.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pure validator: given the player's location and the requested resource,
 * either return the eligible ResourceItem or an error string. Doesn't
 * roll — the caller pairs this with rollGather.
 */
export function validateGather(args: {
  locationId: string;
  resourceId: string;
}): { resource: ResourceItem } | { error: string } {
  const eligible = listResourcesAtLocation(args.locationId);
  const match = eligible.find((r) => r.id === args.resourceId);
  if (!match) {
    return {
      error: `gather_resource: '${args.resourceId}' is not available at '${args.locationId}'`,
    };
  }
  return { resource: match };
}
