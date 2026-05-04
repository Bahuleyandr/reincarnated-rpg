/**
 * Apply legacy traits to a starter form-state — pure function from
 * a player's earned trait counts to a `Record<string, number>` of
 * form-state buffs that the next session should begin with.
 *
 * Called from `lib/game/session.ts:createSession` for logged-in
 * users. Anon sessions never have legacy traits (no durable user
 * row).
 *
 * Stacking semantics (matches imprint.ts):
 *   - A trait's `formState` is applied IF the user has count >= 1.
 *   - Trait counts beyond 1 don't multiply the buff — they exist to
 *     unlock upgrade traits (e.g. fire_scarred → unburnt at count
 *     2). The upgrade trait is its own row with its own bigger buff.
 *   - When both a base trait and an upgrade are present, BOTH apply
 *     additively: fire_scarred (+1 fire_resistance) + unburnt (+2
 *     fire_resistance) = +3 total. Field-level cap enforced at the
 *     SAFETY_CAPS layer when the form-state event lands.
 */
import { SAFETY_CAPS } from "../game/safety";

import { getTrait } from "./traits";

export type LegacyTraitCounts = Readonly<Record<string, number>>;

/**
 * Compute the form-state delta for a player's earned trait counts.
 * Returns a fresh object; safe to merge into any starterFormState.
 */
export function applyLegacyTraitsToStarterFormState(
  counts: LegacyTraitCounts,
): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const [traitId, count] of Object.entries(counts)) {
    if (count <= 0) continue;
    const trait = getTrait(traitId);
    if (!trait) continue;
    for (const [field, value] of Object.entries(trait.formState)) {
      delta[field] = (delta[field] ?? 0) + value;
    }
  }
  // Cap each field at ±SAFETY_CAPS.formStateAbsMax. Cheap defense
  // against a bug authoring a trait with a runaway buff. The
  // tool-validation layer also caps; this is the second line.
  for (const field of Object.keys(delta)) {
    const v = delta[field];
    const cap = SAFETY_CAPS.formStateAbsMax;
    delta[field] = Math.max(-cap, Math.min(cap, v));
  }
  return delta;
}

/**
 * Diagnostic helper for the character page — returns each trait id
 * the user has earned, sorted by count desc, with the trait's
 * label + description.
 */
export function listEarnedTraits(counts: LegacyTraitCounts) {
  const entries: Array<{
    id: string;
    label: string;
    description: string;
    mechanicalEffect: string;
    count: number;
  }> = [];
  for (const [traitId, count] of Object.entries(counts)) {
    if (count <= 0) continue;
    const trait = getTrait(traitId);
    if (!trait) continue;
    entries.push({
      id: trait.id,
      label: trait.label,
      description: trait.description,
      mechanicalEffect: trait.mechanicalEffect,
      count,
    });
  }
  entries.sort((a, b) => b.count - a.count);
  return entries;
}
