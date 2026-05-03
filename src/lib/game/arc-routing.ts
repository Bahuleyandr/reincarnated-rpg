/**
 * Arc routing — given a campaign's (formId, locationId), return a
 * compatible beat pack id. Picked at random from the compatible pool
 * using crypto-strong randomness, so two players with the same
 * starting form+location will land on different arcs.
 *
 * The compatibility table is hand-maintained — adding a beat pack
 * means adding a row here. We deliberately don't infer from the
 * pack JSON because some packs are form-agnostic ("read-the-room"
 * works for slime / book / egg / core alike, but not in every
 * location).
 *
 * `null` (no arc) is a valid outcome — when no entry matches, the
 * run plays free-form, no scripted beats. The narrator drives.
 */
import { randomBytes } from "node:crypto";

interface ArcRoute {
  /** Beat-pack id loadable via loadBeatPack(). */
  arcId: string;
  /** Required form, or null for any. */
  formId: string | null;
  /** Required location, or null for any. */
  locationId: string | null;
  /** Display tagline shown in the run-start UI. */
  tagline: string;
}

const ROUTES: ArcRoute[] = [
  {
    arcId: "survive-the-night",
    formId: "lesser-slime",
    locationId: "collapsed-tunnel",
    tagline:
      "You wake up wet and hungry. Survive the night underground; the dawn is the goal.",
  },
  {
    arcId: "find-the-binder",
    formId: "cursed-book",
    locationId: "sunless-spire",
    tagline:
      "Someone left you open. The candle is still warm. Identify them before the thing at the top of the spire descends.",
  },
  {
    arcId: "keep-the-warmth",
    formId: "dragon-egg",
    locationId: "forsaken-village",
    tagline:
      "The smithy's hearth is dying and the village is empty. Keep your heartbeat alive long enough to be found.",
  },
  {
    arcId: "defend-the-deep",
    formId: "dungeon-core",
    locationId: "sunless-spire",
    tagline:
      "Adventurers are climbing. Claim the spire as your dungeon before they reach the top.",
  },
  {
    arcId: "read-the-room",
    formId: null, // any form works
    locationId: "forsaken-village",
    tagline:
      "Doors open. Hearths warm. Nobody. Find three clues to what called the villagers away.",
  },
];

export interface PickedArc {
  arcId: string;
  tagline: string;
}

/** Returns a random compatible arc, or null when no entry matches.
 *  When `themeWeights` is supplied, each compatible arc is weighted
 *  by themeWeights[arcId] (default 1.0) before sampling. The weekly
 *  theme uses this to nudge picks toward the arc(s) the world is
 *  currently leaning toward. */
export function pickArc(
  formId: string,
  locationId: string,
  themeWeights: Record<string, number> = {},
): PickedArc | null {
  const matches = ROUTES.filter(
    (r) =>
      (r.formId === null || r.formId === formId) &&
      (r.locationId === null || r.locationId === locationId),
  );
  if (matches.length === 0) return null;

  const weighted = matches.map((m) => ({
    ...m,
    weight: themeWeights[m.arcId] ?? 1.0,
  }));
  const total = weighted.reduce((s, m) => s + m.weight, 0);
  if (total <= 0) {
    const idx = randomBytes(1)[0] % matches.length;
    return { arcId: matches[idx].arcId, tagline: matches[idx].tagline };
  }
  const r = (randomBytes(4).readUInt32BE(0) / 0xffffffff) * total;
  let cursor = 0;
  for (const m of weighted) {
    cursor += m.weight;
    if (r <= cursor) return { arcId: m.arcId, tagline: m.tagline };
  }
  // Fallback (rounding) — last entry.
  const last = weighted[weighted.length - 1];
  return { arcId: last.arcId, tagline: last.tagline };
}

/** Lookup-only — used by /api/state to surface the tagline to /play. */
export function arcTagline(arcId: string | null | undefined): string | null {
  if (!arcId) return null;
  return ROUTES.find((r) => r.arcId === arcId)?.tagline ?? null;
}

/** Used by tests + admin tooling. */
export function listArcs(): ArcRoute[] {
  return [...ROUTES];
}
