/**
 * Legacy-trait catalog loader. Pure function over the
 * content/legacy/traits.json catalog. Cached at module load — no
 * file IO at runtime.
 */
import traitsData from "../../../content/legacy/traits.json";

export interface LegacyTrait {
  id: string;
  label: string;
  description: string;
  mechanicalEffect: string;
  /** Form-state buffs applied at session creation when the player
   *  has earned this trait. Keys are arbitrary form-state field
   *  names; values are signed integers (capped by SAFETY_CAPS at
   *  the apply layer). */
  formState: Record<string, number>;
  /** Optional: only awarded when the player has accumulated this
   *  many qualifying deaths. Trait stacking is monotonic — see
   *  src/lib/legacy/imprint.ts. */
  stackThreshold?: number;
}

interface RawCatalog {
  traits: LegacyTrait[];
}

const CATALOG: RawCatalog = traitsData as unknown as RawCatalog;

const TRAITS_BY_ID = new Map<string, LegacyTrait>();
for (const t of CATALOG.traits) TRAITS_BY_ID.set(t.id, t);

export function getTrait(id: string): LegacyTrait | null {
  return TRAITS_BY_ID.get(id) ?? null;
}

export function listTraits(): readonly LegacyTrait[] {
  return CATALOG.traits;
}
