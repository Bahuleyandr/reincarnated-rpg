/**
 * The Long Wyrm — the project's first shared meta-arc.
 *
 * One vast, slow, ancient antagonist that exists ABOVE individual
 * runs. Every player's outcome contributes a small delta to its
 * progress. When progress crosses a phase boundary, the next turn
 * for EVERY player carries new ambient flavor in the system prompt
 * — so a player who logs in tomorrow lands in a different world
 * because of what other players did today.
 *
 * This module:
 *   - Owns the phase ladder (stirring → rising → abroad → feasting → broken)
 *   - Maps "outcome:death" / "outcome:win" / signature-verb tags into deltas
 *   - Writes a meta_contributions row + atomically advances the
 *     meta_arcs.progress + phase
 *   - Exposes getCurrentArc() for the narrator's system prompt
 *
 * Design notes:
 *   - The arc is per-id (id="long-wyrm"). Future arcs would slot in
 *     as new rows + new modules; this one is the v1 reference impl.
 *   - Progress is bounded [0, 1000]. Crossing 1000 triggers the
 *     "broken" phase, which logs a CATASTROPHIC event memory and
 *     resets progress to 0 with phase="stirring" + memory carried
 *     forward (so each cataclysm makes the next ambient flavor
 *     darker).
 *   - Contributions are idempotent per session: persistRunToWorld
 *     calls in here, and we dedupe by (arcId, sessionId).
 */
import { and, count, desc, eq, gt, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { metaArcs, metaContributions, type MetaArc } from "../db/schema";
import type { Event } from "../game/types";
import { uuidv7 } from "../util/uuidv7";
import { log } from "../util/log";

export const LONG_WYRM_ID = "long-wyrm";

export interface PhaseInfo {
  phase: string;
  label: string;
  /** Lower bound (inclusive). */
  min: number;
  /** Upper bound (exclusive). */
  max: number;
  /** Short flavor injected into every player's system prompt during
   *  this phase. Composes a single sentence. */
  ambientFlavor: string;
  /** Hard cap; crossing it triggers the next phase change at next
   *  contribution. The 'broken' phase resets to 0. */
}

const PROGRESS_MAX = 1000;

export const PHASES: PhaseInfo[] = [
  {
    phase: "stirring",
    label: "Stirring",
    min: 0,
    max: 100,
    ambientFlavor:
      "The Long Wyrm is in its long sleep. Players may feel a faint dragline of older breath in their first chamber, but nothing presses.",
  },
  {
    phase: "rising",
    label: "Rising",
    min: 100,
    max: 300,
    ambientFlavor:
      "The Long Wyrm has begun to turn. Tremors register in deep stone. NPCs sleep poorly. The chemistry of every chamber is half a degree warmer than it should be.",
  },
  {
    phase: "abroad",
    label: "Abroad",
    min: 300,
    max: 600,
    ambientFlavor:
      "The Long Wyrm is moving through the world's bones. Predators are bolder. Doors that were closed find themselves open. Nothing has yet been seen, but everything has been touched.",
  },
  {
    phase: "feasting",
    label: "Feasting",
    min: 600,
    max: 900,
    ambientFlavor:
      "The Long Wyrm has surfaced somewhere. Hostile NPCs are aggressive. Innocent NPCs are fewer. The smell of salt and old metal carries on every draft. Something is being eaten elsewhere.",
  },
  {
    phase: "broken",
    label: "Broken",
    min: 900,
    max: PROGRESS_MAX,
    ambientFlavor:
      "The Long Wyrm is everywhere. The world's boundaries no longer hold. This phase ends in cataclysm — and after, the cycle starts again, but the world will remember.",
  },
];

export function phaseForProgress(progress: number): PhaseInfo {
  const clamped = Math.max(0, Math.min(PROGRESS_MAX - 1, progress));
  return PHASES.find((p) => clamped >= p.min && clamped < p.max) ?? PHASES[0];
}

/** Ensures the singleton row exists. Idempotent — safe on every boot. */
export async function ensureLongWyrmExists(db: Db): Promise<void> {
  await db
    .insert(metaArcs)
    .values({
      id: LONG_WYRM_ID,
      progress: 0,
      phase: "stirring",
      phaseLabel: "Stirring",
    })
    .onConflictDoNothing();
}

export async function getCurrentArc(db: Db): Promise<MetaArc | null> {
  const rows = await db.select().from(metaArcs).where(eq(metaArcs.id, LONG_WYRM_ID)).limit(1);
  return rows[0] ?? null;
}

/**
 * Scan the events of a just-ended session and decide the contribution.
 *
 * Rules (intentionally simple, and stronger signals dominate):
 *   - outcome:death       → +5 feed
 *   - outcome:cap         → +1 feed   (the wyrm wins by default)
 *   - outcome:win         → -3 starve
 *   - >=3 absorb tools    → +1 feed   (slime/book absorption nourishes)
 *   - >=2 healed tools    → -1 starve (helping nudges away from feast)
 *   - any wyrm_marked     → +1 feed   (you fed it by being marked)
 *   - any wyrm_attuned    → -1 starve (listening is the opposite of feeding)
 *
 * Returns null if there is nothing to contribute (no session.ended).
 */
export interface ContributionPlan {
  delta: number;
  reason: string;
  prose: string;
}

export function planContribution(events: Event[]): ContributionPlan | null {
  const ended = events.some((e) => e.kind === "session.ended");
  if (!ended) return null;

  let delta = 0;
  const reasons: string[] = [];
  const lastEnd = [...events].reverse().find((e) => e.kind === "session.ended");
  const outcome = lastEnd && lastEnd.kind === "session.ended" ? lastEnd.reason : null;

  if (outcome === "death") {
    delta += 5;
    reasons.push("outcome:death");
  } else if (outcome === "cap") {
    delta += 1;
    reasons.push("outcome:cap");
  } else if (outcome === "win") {
    delta -= 3;
    reasons.push("outcome:win");
  }

  let absorbCount = 0;
  let healCount = 0;
  let wyrmMarkedHits = 0;
  let wyrmAttunedHits = 0;
  for (const e of events) {
    if (e.kind === "absorbed") absorbCount += 1;
    if (e.kind === "healed") healCount += 1;
    if (e.kind === "form_state.changed" && e.field === "wyrm_marked" && e.delta > 0)
      wyrmMarkedHits += 1;
    if (e.kind === "form_state.changed" && e.field === "wyrm_attuned" && e.delta > 0)
      wyrmAttunedHits += 1;
  }
  if (absorbCount >= 3) {
    delta += 1;
    reasons.push("absorb-heavy");
  }
  if (healCount >= 2) {
    delta -= 1;
    reasons.push("heal-heavy");
  }
  if (wyrmMarkedHits > 0) {
    delta += wyrmMarkedHits;
    reasons.push(`wyrm-marked:${wyrmMarkedHits}`);
  }
  if (wyrmAttunedHits > 0) {
    delta -= wyrmAttunedHits;
    reasons.push(`wyrm-attuned:${wyrmAttunedHits}`);
  }

  if (delta === 0 && reasons.length === 0) return null;

  // Compose a short prose line for the public feed.
  const prose =
    delta > 0
      ? `Something fed the Long Wyrm: ${reasons.join(", ")}.`
      : delta < 0
        ? `Something starved the Long Wyrm: ${reasons.join(", ")}.`
        : `A neutral contribution: ${reasons.join(", ")}.`;

  return { delta, reason: reasons.join("|"), prose };
}

interface RecordOpts {
  arcId?: string;
  userId?: string | null;
  sessionId?: string | null;
  campaignId?: string | null;
  formId?: string | null;
  locationId?: string | null;
}

/** Idempotent per session — safe to retry. Returns the new arc state
 *  (with possibly advanced phase) or null if nothing was recorded. */
export async function recordContribution(
  db: Db,
  events: Event[],
  opts: RecordOpts,
): Promise<MetaArc | null> {
  const arcId = opts.arcId ?? LONG_WYRM_ID;
  const plan = planContribution(events);
  if (!plan) return null;

  // Dedupe: if a contribution for this session already exists, skip.
  if (opts.sessionId) {
    const dupes = await db
      .select({ id: metaContributions.id })
      .from(metaContributions)
      .where(
        and(eq(metaContributions.arcId, arcId), eq(metaContributions.sessionId, opts.sessionId)),
      )
      .limit(1);
    if (dupes.length > 0) return getCurrentArc(db);
  }

  await ensureLongWyrmExists(db);
  const cur = await getCurrentArc(db);
  if (!cur) return null;
  const phaseAt = cur.phase;

  // Weekly theme adjusts feed/starve magnitudes. The "Hungry Wyrm"
  // week multiplies feeds by 2; "Quiet Week" cuts feeds in half but
  // boosts starves. Theme multipliers run AFTER the heuristic delta,
  // so a +5 death on a Hungry Wyrm week becomes +10. Recorded delta
  // also reflects the multiplier so the audit log is honest.
  const { activeTheme } = await import("../world/weekly-theme");
  const theme = activeTheme(cur);
  const themedDelta =
    plan.delta > 0
      ? Math.round(plan.delta * theme.feedMultiplier)
      : Math.round(plan.delta * theme.starveMultiplier);

  await db.insert(metaContributions).values({
    id: uuidv7(),
    arcId,
    userId: opts.userId ?? null,
    sessionId: opts.sessionId ?? null,
    campaignId: opts.campaignId ?? null,
    delta: themedDelta,
    reason:
      themedDelta !== plan.delta
        ? `${plan.reason}|theme:${theme.id}:x${theme.feedMultiplier}/${theme.starveMultiplier}`
        : plan.reason,
    prose: plan.prose,
    formId: opts.formId ?? null,
    locationId: opts.locationId ?? null,
    phaseAtContribution: phaseAt,
  });

  // Advance arc state. Atomic UPDATE so concurrent contributions
  // don't double-count. We use SQL expressions to clamp.
  const nextProgress = Math.max(0, Math.min(PROGRESS_MAX, cur.progress + themedDelta));
  const nextPhase = phaseForProgress(nextProgress);
  // Cataclysm: if we hit broken's max, reset to 0/stirring and mark
  // the meta with a "cycle" counter.
  let resetMeta: Record<string, unknown> | null = null;
  let finalProgress = nextProgress;
  let finalPhase = nextPhase;
  if (nextProgress >= PROGRESS_MAX - 1) {
    finalProgress = 0;
    finalPhase = PHASES[0];
    const prevCycle =
      ((cur.meta as Record<string, unknown> | null)?.["cycle"] as number | undefined) ?? 1;
    resetMeta = {
      ...(cur.meta as Record<string, unknown> | null),
      cycle: prevCycle + 1,
      lastBrokenAt: new Date().toISOString(),
    };
  }

  // Update tallies + state. We only bump contributorCount if this is
  // a brand-new userId for this arc — but that requires a separate
  // query, so for v1 we just bump on every distinct sessionId
  // contribution.
  const isStarve = themedDelta < 0;
  const isFeed = themedDelta > 0;

  // Raid HP (Phase 3 Day 13). Every contribution does damage
  // equal to |themedDelta|, regardless of feed/starve. The flavor:
  // every interaction with the world rouses the Wyrm a little.
  // When hp hits 0, the arc "falls" — we reset hp to hp_max + emit
  // a wyrm.fallen audit row in meta.lastFell.
  const damage = Math.abs(themedDelta);
  const curHp = (cur as unknown as { hp?: number }).hp ?? 1000;
  const curHpMax = (cur as unknown as { hp_max?: number; hpMax?: number }).hpMax
    ?? (cur as unknown as { hp_max?: number }).hp_max
    ?? 1000;
  const nextHp = Math.max(0, curHp - damage);
  const wyrmFell = nextHp === 0 && curHp > 0;
  const resetHp = wyrmFell ? curHpMax : nextHp;
  let mergedMeta: Record<string, unknown> | null = resetMeta;
  if (wyrmFell) {
    const base = (resetMeta ?? cur.meta ?? null) as Record<string, unknown> | null;
    const prevFells =
      ((base?.["fellCount"] as number | undefined) ?? 0) + 1;
    mergedMeta = {
      ...(base ?? {}),
      lastFellAt: new Date().toISOString(),
      lastFellSessionId: opts.sessionId,
      lastFellUserId: opts.userId,
      fellCount: prevFells,
    };
  }

  await db
    .update(metaArcs)
    .set({
      progress: finalProgress,
      phase: finalPhase.phase,
      phaseLabel: finalPhase.label,
      totalFeeds: isFeed ? cur.totalFeeds + 1 : cur.totalFeeds,
      totalStarves: isStarve ? cur.totalStarves + 1 : cur.totalStarves,
      contributorCount: cur.contributorCount + 1,
      hp: resetHp,
      ...(mergedMeta ? { meta: mergedMeta } : {}),
      updatedAt: new Date(),
    })
    .where(eq(metaArcs.id, arcId));

  log.info("meta.contribution", {
    arcId,
    sessionId: opts.sessionId,
    rawDelta: plan.delta,
    themedDelta,
    damage,
    hpBefore: curHp,
    hpAfter: resetHp,
    wyrmFell,
    theme: theme.id,
    reason: plan.reason,
    progressBefore: cur.progress,
    progressAfter: finalProgress,
    phaseBefore: phaseAt,
    phaseAfter: finalPhase.phase,
    cataclysm: !!resetMeta,
  });

  if (wyrmFell) {
    log.info("meta.wyrm_fell", {
      arcId,
      sessionId: opts.sessionId,
      userId: opts.userId,
    });
  }

  return await getCurrentArc(db);
}

/**
 * For the /meta page: recent contributions feed (last N).
 */
export async function recentContributions(db: Db, limit = 25) {
  return db
    .select()
    .from(metaContributions)
    .where(eq(metaContributions.arcId, LONG_WYRM_ID))
    .orderBy(desc(metaContributions.createdAt))
    .limit(limit);
}

/**
 * For the /meta page: per-form / per-phase counts in the last N days.
 */
export async function metaSummary(db: Db, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const arc = await getCurrentArc(db);
  const contribs = await db
    .select({
      n: count(),
      delta: sql<number>`COALESCE(SUM(${metaContributions.delta}), 0)::int`,
      formId: metaContributions.formId,
      phaseAt: metaContributions.phaseAtContribution,
    })
    .from(metaContributions)
    .where(and(eq(metaContributions.arcId, LONG_WYRM_ID), gt(metaContributions.createdAt, since)))
    .groupBy(metaContributions.formId, metaContributions.phaseAtContribution);

  return { arc, contribs, sinceDays: days };
}
