/**
 * Rhozell, the Wyrm's hand — Phase 5.5 Day 34-35.
 *
 * Pure decision logic + history-beat composer. The orchestrator
 * calls `shouldRhozellAppear` on turn 1 of new campaigns; if true,
 * the synthetic NPC is introduced and the history beat (built by
 * `composeHistoryBeat`) lands as a high-salience memory entry.
 *
 * Probability:
 *   base = baseLow when arc.progress < threshold, else baseHigh
 *   bonus = perPriorEncounterBonus × runHistory.length
 *   final = clamp(base + bonus, 0, maxAppearanceProbability)
 *
 * Deterministic per (sessionId, turnNumber) via the existing
 * mulberry32 path so replay is stable.
 */
import { mulberry32 } from "../util/rng";

export interface RhozellAppearanceInputs {
  /** Stable per-(session,turn) seed; same shape as wonders/echoes. */
  seed: number;
  /** 0..1 — meta-arc.progress / max. */
  arcProgress: number;
  /** Number of past encounters of any kind for this user. */
  priorEncounters: number;
  /** Test override for the probability check. */
  forceFire?: boolean;
}

export interface RhozellRunHistoryEntry {
  sessionId: string;
  outcome: "killed" | "aided" | "fled" | "spared";
  at: string; // ISO
  /** Form the player was in for this entry. */
  formId?: string;
}

const BASE_LOW = 0.03;
const BASE_HIGH = 0.15;
const ARC_THRESHOLD = 0.5;
const PER_ENCOUNTER_BONUS = 0.05;
const MAX_PROB = 0.45;

const RHOZELL_SEED_OFFSET = 0xc0ffee01;

export function rhozellAppearanceProbability(args: {
  arcProgress: number;
  priorEncounters: number;
}): number {
  const base = args.arcProgress >= ARC_THRESHOLD ? BASE_HIGH : BASE_LOW;
  const bonus = args.priorEncounters * PER_ENCOUNTER_BONUS;
  return Math.min(MAX_PROB, base + bonus);
}

export function shouldRhozellAppear(inputs: RhozellAppearanceInputs): boolean {
  if (inputs.forceFire) return true;
  const p = rhozellAppearanceProbability({
    arcProgress: inputs.arcProgress,
    priorEncounters: inputs.priorEncounters,
  });
  if (p <= 0) return false;
  const rng = mulberry32((inputs.seed ^ RHOZELL_SEED_OFFSET) >>> 0);
  return rng() < p;
}

/**
 * Compose the templated 1-line "history beat" the narrator
 * weaves in on first appearance. Pure — no LLM. Picks the most
 * salient prior outcome (killed > aided > spared > fled) and
 * builds a deterministic line.
 */
export function composeHistoryBeat(
  history: ReadonlyArray<RhozellRunHistoryEntry>,
): string {
  if (history.length === 0) {
    return "Rhozell has not seen you before. He marks you on a list you cannot read.";
  }
  // Priority: killed > aided > spared > fled. Pick the most recent
  // entry of the highest-priority kind so the beat reflects what's
  // freshest.
  const PRIORITY: RhozellRunHistoryEntry["outcome"][] = [
    "killed",
    "aided",
    "spared",
    "fled",
  ];
  for (const kind of PRIORITY) {
    const recent = [...history]
      .reverse()
      .find((e) => e.outcome === kind);
    if (recent) {
      return composeBeatForOutcome(recent, history.length);
    }
  }
  return `Rhozell remembers your face. He counts ${history.length}.`;
}

function composeBeatForOutcome(
  entry: RhozellRunHistoryEntry,
  total: number,
): string {
  const formPhrase = entry.formId
    ? humanForm(entry.formId)
    : "another shape";
  switch (entry.outcome) {
    case "killed":
      return `Rhozell remembers the ${formPhrase} that ended him. The grudge is precise. (${total} encounters in his ledger.)`;
    case "aided":
      return `Rhozell remembers the ${formPhrase} that aided his master. The favor is on his ledger. (${total} encounters.)`;
    case "spared":
      return `Rhozell remembers the ${formPhrase} that did not strike when it could have. He is curious. (${total} encounters.)`;
    case "fled":
      return `Rhozell remembers the ${formPhrase} that ran. He is patient. (${total} encounters.)`;
    default: {
      const _x: never = entry.outcome;
      void _x;
      return `Rhozell counts ${total} encounters with you, across lives.`;
    }
  }
}

function humanForm(id: string): string {
  return id.replace(/-/g, " ");
}

/**
 * Pure: classify how a run "ended for Rhozell" given the run's
 * events. Used by the persist hook to append to runHistory.
 *   - 'killed' — player applied damage to Rhozell that brought
 *      him to 0 HP (we infer from a relationship.updated with
 *      delta <= -3 OR a damage.applied targeting him with
 *      cumulative >=18).
 *   - 'aided' — relationship.updated delta >= +3.
 *   - 'spared' — Rhozell was in scene but no damage applied.
 *   - 'fled'  — neither side resolved the encounter.
 *
 * The orchestrator only calls this when Rhozell appeared in the
 * run (npc.introduced for templateId='rhozell'). We pick the
 * single best label — runs rarely have two of these for one NPC.
 */
export function classifyRhozellOutcome(
  events: ReadonlyArray<{ kind: string } & Record<string, unknown>>,
  rhozellNpcId: string,
): RhozellRunHistoryEntry["outcome"] {
  let damageDealt = 0;
  let relationshipDelta = 0;
  let appeared = false;
  for (const e of events) {
    if (e.kind === "npc.introduced" && (e as { npcId?: unknown }).npcId === rhozellNpcId) {
      appeared = true;
    }
    if (
      e.kind === "damage.applied" &&
      (e as { target?: unknown }).target === rhozellNpcId
    ) {
      const amt = (e as Record<string, unknown>).amount;
      if (typeof amt === "number") damageDealt += amt;
    }
    if (
      e.kind === "relationship.updated" &&
      (e as { npcId?: unknown }).npcId === rhozellNpcId
    ) {
      const dlt = (e as Record<string, unknown>).delta;
      if (typeof dlt === "number") relationshipDelta += dlt;
    }
  }
  if (!appeared) return "fled";
  if (damageDealt >= 18 || relationshipDelta <= -3) return "killed";
  if (relationshipDelta >= 3) return "aided";
  if (damageDealt === 0 && relationshipDelta === 0) return "spared";
  return "fled";
}
