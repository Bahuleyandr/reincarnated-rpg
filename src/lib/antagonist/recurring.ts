/**
 * Recurring NPC engine — Phase 7 Day 45-46.
 *
 * Generalizes the Rhozell pattern (Day 34-35). Any NPC content
 * file with `metadata.recurring: true` is eligible. The engine
 * scans the catalog at boot, picks at most one recurring NPC per
 * turn-1 via per-NPC probability + arc/encounter modifiers, and
 * surfaces the same kind of templated history beat.
 *
 * Per-NPC modules (e.g. lib/antagonist/rhozell.ts) own the
 * specific composeHistoryBeat + classifyOutcome logic. This
 * module is the dispatcher.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { mulberry32 } from "../util/rng";

export interface RecurringNpcMeta {
  templateId: string;
  recurring: true;
  faction?: string;
  voice?: string;
  topicsOfInterest?: string[];
  appearanceProbability: {
    baseLow: number;
    baseHigh: number;
    wyrmPhaseThreshold: number;
    perPriorEncounterBonus: number;
    maxAppearanceProbability: number;
  };
}

const cache: { catalog: RecurringNpcMeta[] | null } = { catalog: null };

export function listRecurringNpcs(): RecurringNpcMeta[] {
  if (cache.catalog) return cache.catalog;
  const dir = join(process.cwd(), "content", "npcs");
  if (!existsSync(dir)) {
    cache.catalog = [];
    return cache.catalog;
  }
  const out: RecurringNpcMeta[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(
        readFileSync(join(dir, file), "utf-8"),
      ) as { metadata?: { recurring?: unknown } & Partial<RecurringNpcMeta> };
      const meta = raw.metadata;
      if (!meta || meta.recurring !== true) continue;
      if (!meta.templateId || !meta.appearanceProbability) continue;
      // Validate the probability shape lightly.
      const ap = meta.appearanceProbability;
      if (
        typeof ap.baseLow !== "number" ||
        typeof ap.baseHigh !== "number" ||
        typeof ap.wyrmPhaseThreshold !== "number" ||
        typeof ap.perPriorEncounterBonus !== "number" ||
        typeof ap.maxAppearanceProbability !== "number"
      ) {
        continue;
      }
      out.push({
        templateId: meta.templateId,
        recurring: true,
        faction: meta.faction,
        voice: meta.voice,
        topicsOfInterest: meta.topicsOfInterest,
        appearanceProbability: ap,
      });
    } catch {
      // skip malformed
    }
  }
  cache.catalog = out;
  return out;
}

/** For tests. */
export function clearRecurringNpcCache(): void {
  cache.catalog = null;
}

/**
 * Pure: per-NPC appearance probability.
 *
 *   base  = baseLow when arcProgress < wyrmPhaseThreshold else baseHigh
 *   bonus = perPriorEncounterBonus × priorEncounters
 *   final = min(base + bonus, maxAppearanceProbability)
 */
export function appearanceProbabilityFor(args: {
  meta: RecurringNpcMeta;
  arcProgress: number;
  priorEncounters: number;
}): number {
  const ap = args.meta.appearanceProbability;
  const base = args.arcProgress >= ap.wyrmPhaseThreshold ? ap.baseHigh : ap.baseLow;
  const bonus = args.priorEncounters * ap.perPriorEncounterBonus;
  return Math.min(ap.maxAppearanceProbability, base + bonus);
}

export interface RecurringPickInputs {
  /** Stable per-(session,turn) seed. */
  seed: number;
  arcProgress: number;
  /** Map of templateId → priorEncountersForUser. */
  priorEncountersByNpc: Record<string, number>;
  /** Already-introduced NPCs in the projection — skip these. */
  introducedTemplateIds: ReadonlySet<string>;
  /** Test override: force-fire this template. */
  forceFire?: string;
}

const RECURRING_SEED_OFFSET = 0xa0a0b1b1;

/**
 * Pick at most one recurring NPC to spawn this turn. Walks the
 * catalog deterministically (sorted by templateId so order is
 * stable across restarts), rolls each via the per-NPC probability,
 * and returns the first hit. Already-introduced NPCs are skipped.
 */
export function pickRecurringNpc(
  inputs: RecurringPickInputs,
): RecurringNpcMeta | null {
  const catalog = [...listRecurringNpcs()].sort((a, b) =>
    a.templateId.localeCompare(b.templateId),
  );
  if (inputs.forceFire) {
    return (
      catalog.find((c) => c.templateId === inputs.forceFire) ?? null
    );
  }
  const rng = mulberry32((inputs.seed ^ RECURRING_SEED_OFFSET) >>> 0);
  for (const meta of catalog) {
    if (inputs.introducedTemplateIds.has(meta.templateId)) continue;
    const p = appearanceProbabilityFor({
      meta,
      arcProgress: inputs.arcProgress,
      priorEncounters: inputs.priorEncountersByNpc[meta.templateId] ?? 0,
    });
    if (p <= 0) continue;
    if (rng() < p) return meta;
  }
  return null;
}
