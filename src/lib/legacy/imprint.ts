/**
 * Death-cause classifier — pure function from a session's events
 * (and the projection at end-of-run) to a legacy-trait id.
 *
 * Rationale: `session.ended.reason` is too coarse — only "death" /
 * "won" / "cap". To pick the right trait we walk back through events
 * to find the last `damage.applied` and use its `source` / `vital`
 * to classify the cause. Falls back to the form's primary
 * vulnerability when no damage event is found.
 *
 * The trait awarded is monotonic-stacking: a second qualifying
 * death of the same family upgrades the trait (e.g. fire_scarred →
 * unburnt at threshold 2). The stacking threshold lives in
 * content/legacy/traits.json on the *upgrade* trait; the imprint
 * function returns the upgrade slug when the player has hit it.
 */
import type { Event } from "../game/types";

export interface DeathContext {
  /** session.ended.reason. Only "death" produces a scar; "won" /
   *  "cap" award their own (gentler) traits. */
  reason: "death" | "win" | "cap";
  formId: string;
  /** Full event log for the run, in order. */
  events: readonly Event[];
  /** Optional: the player's existing trait counts. Used to compute
   *  upgrades (e.g. one fire death → fire_scarred; two → unburnt). */
  existingTraits?: Readonly<Record<string, number>>;
}

export interface ImprintResult {
  /** Trait slug to credit. Null if the death doesn't classify. */
  traitId: string | null;
  /** Cause family — used by the upgrade rules ("fire" → can stack
   *  to fire_scarred → unburnt). Helpful for telemetry. */
  causeFamily: string | null;
}

const SOURCE_TO_FAMILY: Array<{ pattern: RegExp; family: string; trait: string }> = [
  { pattern: /^(fire|flame|burn|ember|pyre|ash)/i, family: "fire", trait: "fire_scarred" },
  { pattern: /^(water|drown|tide|deluge|cistern|flood)/i, family: "water", trait: "water_affinity" },
  { pattern: /^(crush|weight|press|fall|stone)/i, family: "crush", trait: "crushed" },
  { pattern: /^(fall|gravity|cliff|drop)/i, family: "gravity", trait: "gravity_aware" },
  { pattern: /^(venom|poison|toxin|envenom)/i, family: "venom", trait: "venom_remembered" },
  { pattern: /^(starve|hunger|wither|starvation)/i, family: "starve", trait: "starved" },
  { pattern: /^(betray|ally|friend|knife)/i, family: "betray", trait: "betrayed" },
  { pattern: /^(claw|tooth|fang|bite|tear|maul)/i, family: "torn", trait: "torn" },
  { pattern: /^(cold|freeze|frost|ice)/i, family: "cold", trait: "exposed" },
  { pattern: /^(self|own[-_]tool|backfire|recoil)/i, family: "self", trait: "self_undone" },
  { pattern: /^(wyrm|long[-_]wyrm|long_wyrm|the[-_]wyrm)/i, family: "wyrm", trait: "wyrm_touched" },
];

const FORM_FALLBACK: Record<string, string> = {
  "lesser-slime": "drowned", // slimes typically end in fluid loss / desiccation
  "cursed-book": "binder_broken",
  "dragon-egg": "exposed",
  "dungeon-core": "core_cracked",
  "healer": "torn",
};

const UPGRADES: Record<string, { upgradeTo: string; threshold: number }> = {
  // fire_scarred at count >= 2 → unburnt
  fire_scarred: { upgradeTo: "unburnt", threshold: 2 },
  // water_affinity at count >= 2 → drowned
  water_affinity: { upgradeTo: "drowned", threshold: 2 },
};

/**
 * Classify the death and return a trait slug to credit. The pure
 * single-shot function: imprintTraitFromDeath(ctx) → trait id.
 *
 * Calling order:
 *   1. If reason !== "death" → use the soft fallback ("abandoned"
 *      for cap, no trait for win). Wins are their own reward; we
 *      don't overload them with traits in v1.
 *   2. Walk back through events to find the last damage.applied.
 *   3. If found, classify by source.
 *   4. If not, use the form-specific fallback.
 *   5. Apply the upgrade rule based on the player's existing
 *      trait counts.
 */
export function imprintTraitFromDeath(ctx: DeathContext): ImprintResult {
  if (ctx.reason === "win") {
    return { traitId: null, causeFamily: null };
  }
  if (ctx.reason === "cap") {
    return { traitId: "abandoned", causeFamily: "cap" };
  }

  // Death path — find the last damage.applied event.
  const lastDamage = findLastDamage(ctx.events);
  let baseTrait: string;
  let family: string;
  if (lastDamage) {
    const matched = SOURCE_TO_FAMILY.find((rule) =>
      rule.pattern.test(lastDamage.source),
    );
    if (matched) {
      baseTrait = matched.trait;
      family = matched.family;
    } else {
      baseTrait = FORM_FALLBACK[ctx.formId] ?? "many_lived";
      family = "form-fallback";
    }
  } else {
    baseTrait = FORM_FALLBACK[ctx.formId] ?? "many_lived";
    family = "form-fallback";
  }

  // Upgrade rule: if the player ALREADY has the base trait at the
  // upgrade-threshold count, credit the upgrade slug instead. The
  // base trait's count still increments — the upgrade is a new
  // entry on top, not a replacement.
  const upgrade = UPGRADES[baseTrait];
  if (upgrade && (ctx.existingTraits?.[baseTrait] ?? 0) >= upgrade.threshold - 1) {
    return { traitId: upgrade.upgradeTo, causeFamily: family };
  }

  return { traitId: baseTrait, causeFamily: family };
}

function findLastDamage(events: readonly Event[]): { source: string; vital?: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "damage.applied") {
      return { source: e.source, vital: e.vital };
    }
  }
  return null;
}

/**
 * Apply an imprint to a user's existing trait counts. Pure: returns
 * a new `{ [traitId]: count }` object. The caller persists it.
 *
 * Stacking is monotonic — a second fire death credits *both* the
 * `fire_scarred` count AND the `unburnt` upgrade trait (if the
 * threshold is hit). The character page renders the highest-tier
 * trait per family preferentially.
 */
export function applyImprint(
  existing: Readonly<Record<string, number>>,
  imprint: ImprintResult,
): Record<string, number> {
  if (!imprint.traitId) return { ...existing };
  const next = { ...existing };
  next[imprint.traitId] = (next[imprint.traitId] ?? 0) + 1;
  return next;
}
