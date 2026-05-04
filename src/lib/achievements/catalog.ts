/**
 * Achievement catalog loader.
 *
 * Reads content/achievements.json once at module load, parses each
 * entry's JSON-DSL predicate into an executable Predicate, and
 * exposes the typed catalog. Parse errors throw at boot — better to
 * fail loud than silently drop achievements.
 */
import achievementsData from "../../../content/achievements.json";

import { parsePredicate, type DslNode } from "./dsl-parser";
import type { Predicate } from "../predicates/types";
import type { EventKind } from "../game/types";

export type AchievementScope = "session" | "lifetime";

export interface AchievementEntry {
  id: string;
  label: string;
  description: string;
  /** Compiled predicate (parsePredicate result). */
  predicate: Predicate;
  /**
   * Event kinds this achievement cares about. Used as a cheap
   * pre-filter: if the recent event slice contains none of these
   * kinds, skip evaluation entirely. Achievements with no kinds
   * declared are evaluated unconditionally (rare).
   */
  relevantKinds: EventKind[];
  /**
   * Where the predicate runs:
   *   "session" — over a single session's event log.
   *   "lifetime" — over the cross-session aggregate (all of the
   *     player's sessions). Evaluated only at run-end (cheaper)
   *     by the runner.
   */
  scope: AchievementScope;
  /** Optional title slug awarded on unlock. Filled in Phase 1 Day 5. */
  titleAwarded?: string | null;
  /** Hidden achievements aren't listed in the catalog API until
   *  unlocked. Default false. */
  hidden?: boolean;
}

interface RawEntry {
  id: string;
  label: string;
  description: string;
  predicate: DslNode;
  relevantKinds: string[];
  scope?: string;
  titleAwarded?: string | null;
  hidden?: boolean;
}

interface RawCatalog {
  achievements: RawEntry[];
}

const RAW = (achievementsData as unknown as RawCatalog).achievements;

const CATALOG: AchievementEntry[] = RAW.map((raw) => {
  let predicate: Predicate;
  try {
    predicate = parsePredicate(raw.predicate);
  } catch (err) {
    throw new Error(
      `achievement '${raw.id}': predicate parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const scope: AchievementScope =
    raw.scope === "lifetime" ? "lifetime" : "session";
  return {
    id: raw.id,
    label: raw.label,
    description: raw.description,
    predicate,
    relevantKinds: (raw.relevantKinds ?? []) as EventKind[],
    scope,
    titleAwarded: raw.titleAwarded ?? null,
    hidden: raw.hidden ?? false,
  };
});

const BY_ID = new Map<string, AchievementEntry>();
for (const entry of CATALOG) BY_ID.set(entry.id, entry);

export function listAchievements(): readonly AchievementEntry[] {
  return CATALOG;
}

export function listSessionAchievements(): readonly AchievementEntry[] {
  return CATALOG.filter((a) => a.scope === "session");
}

export function listLifetimeAchievements(): readonly AchievementEntry[] {
  return CATALOG.filter((a) => a.scope === "lifetime");
}

export function getAchievement(id: string): AchievementEntry | null {
  return BY_ID.get(id) ?? null;
}
