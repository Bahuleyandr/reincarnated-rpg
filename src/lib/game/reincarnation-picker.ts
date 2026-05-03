/**
 * The "God of the new world" reincarnation picker.
 *
 * Loads the curated catalog from content/reincarnations/options.json,
 * queries the live distribution of active campaigns, and returns N
 * options weighted to maintain ecosystem balance:
 *
 *   - Common options always pickable (default weight 1.0)
 *   - Uncommon options nudged in with bonus skills when their typed
 *     form is under-represented
 *   - Rare options surface specifically when the picker wants to push
 *     equilibrium — they carry starterBonus payloads ("if you take
 *     this, +1 awareness") so the player feels rewarded for choosing
 *     against the meta
 *
 * Saturation penalty: if a typed form is over a threshold of total
 * active campaigns in the last 7 days, options routing to it get
 * their weight slashed. Hard cap at 50% — past that, an option
 * becomes practically unpickable except via free-text override.
 *
 * The picker is deterministic-given-distribution per call (uses
 * crypto-strong randomness to weight-sample so the same God dialog
 * doesn't show the same set every call).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { and, eq, gte, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import type { Db } from "../db/client";
import { campaigns } from "../db/schema";

export interface ReincarnationOption {
  id: string;
  label: string;
  description: string;
  typedFormHint: string;
  tier: "common" | "uncommon" | "rare";
  weight: number;
  starterBonus: { field: string; value: number } | null;
}

interface CatalogJson {
  _meta: unknown;
  options: ReincarnationOption[];
}

let cached: ReincarnationOption[] | null = null;
function loadCatalog(): ReincarnationOption[] {
  if (cached) return cached;
  const raw = readFileSync(
    join(process.cwd(), "content", "reincarnations", "options.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as CatalogJson;
  cached = parsed.options;
  return cached;
}

/** Test-only — clears the parsed catalog so a hot edit takes effect. */
export function _resetCatalogCacheForTests(): void {
  cached = null;
}

/** Distribution from the campaigns table. Returns a map from formId
 *  to count of active campaigns started in the last `days` days. */
export async function liveDistribution(
  db: Db,
  days = 7,
): Promise<Map<string, number>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      formId: campaigns.formId,
      n: sql<number>`count(*)::int`,
    })
    .from(campaigns)
    .where(
      and(eq(campaigns.status, "active"), gte(campaigns.createdAt, since)),
    )
    .groupBy(campaigns.formId);
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.formId, r.n);
  return out;
}

const TIER_BASE: Record<string, number> = {
  common: 1.0,
  uncommon: 0.8,
  rare: 0.5,
};

/**
 * Compute a saturation penalty: if more than 30% of recent campaigns
 * land on a typed form, options routing to it get heavily penalized.
 * Returns a multiplier in [0.05, 1.0].
 */
function saturationPenalty(
  formId: string,
  distribution: Map<string, number>,
  totalCampaigns: number,
): number {
  if (totalCampaigns < 5) return 1.0; // small samples don't drive nudges
  const share = (distribution.get(formId) ?? 0) / totalCampaigns;
  if (share <= 0.15) return 1.5; // boost — under-represented form
  if (share <= 0.3) return 1.0;
  if (share <= 0.5) return 0.3;
  return 0.05; // saturated
}

export interface PickerResult {
  options: Array<
    ReincarnationOption & {
      /** Final weight used in selection. Surfaced for the UI to render
       *  a subtle hint ("the God is nudging you here"). */
      effectiveWeight: number;
      /** True when the option's typed form is currently
       *  over-represented and the God is actively de-weighting it. */
      saturated: boolean;
    }
  >;
  totalActive: number;
  byForm: Record<string, number>;
}

/**
 * Build the offer the God makes the player.
 *
 * Returns N options drawn from the catalog with weighted random
 * sampling. At least one rare option is guaranteed to appear when
 * any typed form is over the saturation threshold — that's the
 * "would you like this instead?" nudge.
 *
 * `excludeFormIds` lets the caller forbid specific forms (e.g.,
 * for an admin override).
 */
export async function offerReincarnations(
  db: Db,
  opts: {
    n?: number;
    excludeFormIds?: string[];
    /** Per-option weight overrides (admin-side; loaded from /god). */
    weightOverrides?: Record<string, number>;
  } = {},
): Promise<PickerResult> {
  const n = opts.n ?? 6;
  const excluded = new Set(opts.excludeFormIds ?? []);
  const distribution = await liveDistribution(db);
  const totalActive = Array.from(distribution.values()).reduce(
    (a, b) => a + b,
    0,
  );

  const catalog = loadCatalog().filter(
    (o) => !excluded.has(o.typedFormHint),
  );

  const weighted = catalog.map((o) => {
    const tierMult = TIER_BASE[o.tier] ?? 0.5;
    const sat = saturationPenalty(o.typedFormHint, distribution, totalActive);
    const ovr = opts.weightOverrides?.[o.id] ?? 1.0;
    const effective = o.weight * tierMult * sat * ovr;
    const saturated =
      totalActive >= 5 &&
      ((distribution.get(o.typedFormHint) ?? 0) / Math.max(1, totalActive)) >
        0.3;
    return { ...o, effectiveWeight: effective, saturated };
  });

  // Weighted-random sample of N distinct entries.
  const sampled: typeof weighted = [];
  const remaining = [...weighted];
  for (let i = 0; i < n && remaining.length > 0; i++) {
    const totalW = remaining.reduce((a, b) => a + b.effectiveWeight, 0);
    if (totalW <= 0) {
      // Everything saturated — fall back to flat sample.
      const idx = randomBytes(1)[0] % remaining.length;
      sampled.push(remaining[idx]);
      remaining.splice(idx, 1);
      continue;
    }
    // Crypto-strong float in [0, totalW).
    const buf = randomBytes(4).readUInt32BE(0);
    let target = (buf / 0xffffffff) * totalW;
    let pickIdx = 0;
    for (let j = 0; j < remaining.length; j++) {
      target -= remaining[j].effectiveWeight;
      if (target <= 0) {
        pickIdx = j;
        break;
      }
    }
    sampled.push(remaining[pickIdx]);
    remaining.splice(pickIdx, 1);
  }

  // Guarantee: if any form is saturated, at least one rare option
  // (with starterBonus) must be in the offer — that's the God's
  // nudge. Find the highest-weight rare-with-bonus not already in
  // the sample and swap it in for the lowest-weight non-rare slot.
  const anySaturated = weighted.some((w) => w.saturated);
  const hasRare = sampled.some((s) => s.tier === "rare");
  if (anySaturated && !hasRare) {
    const candidateRares = weighted
      .filter(
        (w) =>
          w.tier === "rare" &&
          !sampled.some((s) => s.id === w.id) &&
          w.starterBonus,
      )
      .sort((a, b) => b.effectiveWeight - a.effectiveWeight);
    if (candidateRares.length > 0) {
      // Prefer to evict a saturated common; if none is in the
      // sample, evict the lowest-weight non-rare slot.
      const saturatedIdx = sampled.findIndex((s) => s.saturated);
      const fallbackIdx = sampled
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.tier !== "rare")
        .sort((a, b) => a.s.effectiveWeight - b.s.effectiveWeight)[0]?.i;
      const swapIdx =
        saturatedIdx >= 0
          ? saturatedIdx
          : (fallbackIdx ?? sampled.length - 1);
      sampled[swapIdx] = candidateRares[0];
    }
  }

  const byForm: Record<string, number> = {};
  for (const [k, v] of distribution) byForm[k] = v;

  return { options: sampled, totalActive, byForm };
}

/** Lookup-only — used by /api/campaigns POST when an option id is
 *  passed, to retrieve the starterBonus + form hint. */
export function findOption(id: string): ReincarnationOption | null {
  return loadCatalog().find((o) => o.id === id) ?? null;
}
