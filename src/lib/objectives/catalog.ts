/**
 * Daily/weekly objective catalog loader. Same shape as the
 * achievements catalog: predicates compile through the JSON-DSL
 * parser at module load.
 */
import objectivesData from "../../../content/objectives.json";

import { parsePredicate, type DslNode } from "../achievements/dsl-parser";
import type { Predicate } from "../predicates/types";
import type { EventKind } from "../game/types";

import type { ObjectivePeriod } from "./period";

export interface ObjectiveReward {
  kind: "energy";
  amount: number;
}

export interface ObjectiveEntry {
  id: string;
  label: string;
  description: string;
  period: ObjectivePeriod;
  target: number;
  predicate: Predicate;
  relevantKinds: EventKind[];
  reward: ObjectiveReward;
}

interface RawEntry {
  id: string;
  label: string;
  description: string;
  period: string;
  target: number;
  predicate: DslNode;
  relevantKinds: string[];
  reward: ObjectiveReward;
}

interface RawCatalog {
  objectives: RawEntry[];
}

const RAW = (objectivesData as unknown as RawCatalog).objectives;

const CATALOG: ObjectiveEntry[] = RAW.map((raw) => {
  let predicate: Predicate;
  try {
    predicate = parsePredicate(raw.predicate);
  } catch (err) {
    throw new Error(
      `objective '${raw.id}': predicate parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (raw.period !== "daily" && raw.period !== "weekly") {
    throw new Error(
      `objective '${raw.id}': period must be 'daily' or 'weekly' (got '${raw.period}')`,
    );
  }
  if (typeof raw.target !== "number" || raw.target < 1) {
    throw new Error(`objective '${raw.id}': target must be a positive integer`);
  }
  return {
    id: raw.id,
    label: raw.label,
    description: raw.description,
    period: raw.period,
    target: raw.target,
    predicate,
    relevantKinds: (raw.relevantKinds ?? []) as EventKind[],
    reward: raw.reward,
  };
});

const BY_ID = new Map<string, ObjectiveEntry>();
for (const entry of CATALOG) BY_ID.set(entry.id, entry);

export function listObjectives(): readonly ObjectiveEntry[] {
  return CATALOG;
}

export function listDaily(): readonly ObjectiveEntry[] {
  return CATALOG.filter((o) => o.period === "daily");
}

export function listWeekly(): readonly ObjectiveEntry[] {
  return CATALOG.filter((o) => o.period === "weekly");
}

export function getObjective(id: string): ObjectiveEntry | null {
  return BY_ID.get(id) ?? null;
}
