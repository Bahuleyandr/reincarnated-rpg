/**
 * Memorability — Phase 5.5 Day 28.
 *
 * Pure function: given an event-log slice + projection, decide if a
 * run's death qualifies as "memorable" enough to leave a `world_lore`
 * entry. Trivial deaths (turn 1-2 starvation) are not memorable;
 * long, dramatic, or thematic deaths are.
 *
 * Triggers (any one):
 *   - died at <2 HP after 30+ turns (a long survival cut short)
 *   - killed by a named NPC (templateId set + threat=true)
 *   - first death of a brand-new form for this user
 *   - died to own tool (apply_damage with target=$SELF and source=narrator)
 *   - 50+ turns survived (just impressive endurance)
 *
 * Streak-break detection happens at the orchestrator layer (it's the
 * only thing with cross-run state); we just receive a `streakBefore`
 * hint when the caller has it.
 *
 * The headline is built deterministically here too — no LLM. The
 * `lore-judge` path is reserved for richer narrative; famous deaths
 * stay templated for cost discipline.
 */
import type { Event, Projection } from "../game/types";

export interface MemorabilityInputs {
  events: ReadonlyArray<Event>;
  projection: Projection;
  /** Player's display label — `reincarnatedAs` if set, else a form-
   *  derived fallback. The caller resolves this; we just template it. */
  protagonistLabel: string;
  /** Set when the caller has cross-run streak context. >=3 means
   *  breaking the streak makes the death memorable on its own. */
  streakBefore?: number;
  /** True if this is the first time the user has died as this form.
   *  Caller queries world_npcs / world_memories for prior deaths. */
  firstDeathOfForm?: boolean;
}

export interface MemorabilityResult {
  memorable: boolean;
  /** Template-built one-liner; null when not memorable. */
  headline: string | null;
  /** 0..1 — drives lore ordering on the public ticker. */
  salience: number;
  /** What triggered the verdict (for audit/UI). */
  reasons: string[];
}

const NEAR_DEATH_HP = 2;
const NEAR_DEATH_TURN_THRESHOLD = 30;
const ENDURANCE_TURN_THRESHOLD = 50;
const STREAK_BREAK_THRESHOLD = 3;

export function evaluateMemorability(
  inputs: MemorabilityInputs,
): MemorabilityResult {
  const reasons: string[] = [];

  const ended = inputs.events.find((e) => e.kind === "session.ended");
  if (!ended || ended.kind !== "session.ended" || ended.reason !== "death") {
    return {
      memorable: false,
      headline: null,
      salience: 0,
      reasons: ["not-a-death"],
    };
  }

  const turnCount = inputs.events.filter((e) => e.kind === "turn.begun").length;
  const damageEvents = inputs.events.filter(
    (e) => e.kind === "damage.applied",
  );

  // Find the killing blow — last damage.applied with target=$SELF
  const killingBlow = [...damageEvents]
    .reverse()
    .find(
      (e): e is Event & { kind: "damage.applied" } =>
        e.kind === "damage.applied" && e.target === "$SELF",
    );

  // Trigger: long survival cut short.
  if (turnCount >= NEAR_DEATH_TURN_THRESHOLD) {
    // Was the killing blow a near-death cliff? Check if the player's
    // HP was under NEAR_DEATH_HP for the killing-blow's vital before
    // the final hit. We approximate by looking at the projection's
    // final vital state.
    const deathVital = primaryDeathVital(inputs.projection);
    const finalHp = inputs.projection.form.vitals[deathVital] ?? 0;
    if (finalHp <= NEAR_DEATH_HP) {
      reasons.push("near-death-after-30");
    }
  }

  // Trigger: killed by a named NPC.
  if (killingBlow && killingBlow.source) {
    const src = killingBlow.source.toLowerCase();
    // Heuristic: the source string mentions an NPC slug (kebab-case
    // tokens with at least one hyphen, OR matches a known npc id in
    // projection.npcs).
    const namedFromProjection = Object.values(inputs.projection.npcs).some(
      (n) => {
        const name = (n as { name?: unknown }).name;
        if (typeof name === "string" && src.includes(name.toLowerCase())) {
          return true;
        }
        const tpl = (n as { templateId?: unknown }).templateId;
        return typeof tpl === "string" && src.includes(tpl.toLowerCase());
      },
    );
    const looksLikeSlug = /-[a-z]/.test(src);
    if (namedFromProjection || looksLikeSlug) {
      reasons.push("named-killer");
    }
  }

  // Trigger: first-death-of-form.
  if (inputs.firstDeathOfForm) reasons.push("first-death-of-form");

  // Trigger: streak-break.
  if (
    inputs.streakBefore !== undefined &&
    inputs.streakBefore >= STREAK_BREAK_THRESHOLD
  ) {
    reasons.push(`streak-break-${inputs.streakBefore}`);
  }

  // Trigger: pure endurance.
  if (turnCount >= ENDURANCE_TURN_THRESHOLD) {
    reasons.push("endurance-50");
  }

  if (reasons.length === 0) {
    return {
      memorable: false,
      headline: null,
      salience: 0,
      reasons: ["trivial-death"],
    };
  }

  // Compose headline. Pick the highest-priority reason for the lead.
  const headline = composeHeadline({
    label: inputs.protagonistLabel,
    formId: inputs.projection.form.id,
    locationId: inputs.projection.location.id,
    turnCount,
    killer: killingBlow?.source ?? null,
    reasons,
    streakBefore: inputs.streakBefore,
  });

  // Salience: 0.5 base + 0.1 per trigger, capped at 0.95.
  const salience = Math.min(0.95, 0.5 + reasons.length * 0.1);

  return { memorable: true, headline, salience, reasons };
}

function primaryDeathVital(projection: Projection): string {
  for (const [name, threshold] of Object.entries(projection.form.vitalsDeath)) {
    if (threshold !== null) return name;
  }
  return Object.keys(projection.form.vitals)[0] ?? "cohesion";
}

interface HeadlineInputs {
  label: string;
  formId: string;
  locationId: string;
  turnCount: number;
  killer: string | null;
  reasons: string[];
  streakBefore?: number;
}

function composeHeadline(args: HeadlineInputs): string {
  const where = humanLocation(args.locationId);
  // Reason priority: streak-break > named-killer > endurance >
  // near-death > first-death.
  if (args.reasons.some((r) => r.startsWith("streak-break"))) {
    return `${args.label} broke a ${args.streakBefore}-day streak in ${where} on turn ${args.turnCount}.`;
  }
  if (args.reasons.includes("named-killer") && args.killer) {
    return `${args.label} fell to ${humanizeKiller(args.killer)} in ${where} on turn ${args.turnCount}.`;
  }
  if (args.reasons.includes("endurance-50")) {
    return `${args.label} survived ${args.turnCount} turns in ${where} before the cycle closed.`;
  }
  if (args.reasons.includes("near-death-after-30")) {
    return `${args.label} bled out in ${where} on turn ${args.turnCount}, a breath from making it through.`;
  }
  if (args.reasons.includes("first-death-of-form")) {
    return `${args.label} (${humanizeForm(args.formId)}) was lost in ${where} on turn ${args.turnCount} — the first of their kind.`;
  }
  return `${args.label} died in ${where} on turn ${args.turnCount}.`;
}

function humanLocation(locationId: string): string {
  return locationId.replace(/-/g, " ");
}

function humanizeForm(formId: string): string {
  return formId.replace(/-/g, " ");
}

function humanizeKiller(source: string): string {
  // The source string is whatever the narrator passed via apply_damage.
  // Strip technical noise; trust the narrator otherwise.
  const cleaned = source.replace(/-\d+$/, "").replace(/-/g, " ");
  return cleaned.length > 60 ? cleaned.slice(0, 60) + "…" : cleaned;
}
