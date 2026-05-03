/**
 * Rotating weekly themes.
 *
 * Each ISO week, the world has a "theme" that biases gameplay
 * subtly: which arcs the picker prefers, how strongly the
 * meta-arc reacts, the turn cap, and an ambient flavor sentence
 * the narrator weaves in. The theme is the same for ALL players
 * in a given week — multiplayer-shape, not per-user.
 *
 * Determinism: the active theme for a given Date is computed
 * from its ISO week number modulo the catalog length. Runs at
 * the same wall-clock instant resolve to the same theme on every
 * server. No DB read on the hot path.
 *
 * Admin override: /god can pin a specific theme id (stored in
 * meta_arcs.meta.themeOverride). When present, getActiveTheme()
 * returns it instead of the rotation. This lets operators run
 * one-off events.
 */
import type { MetaArc } from "../db/schema";

export interface WeeklyTheme {
  id: string;
  label: string;
  description: string;
  /** Sentence injected into every player's narrator system prompt
   *  for the week. Subtle ambient. */
  ambientFlavor: string;
  /** Multipliers applied to meta-arc contribution deltas.
   *  feedMultiplier > 1 = wyrm advances faster on this week's
   *  feeds. starveMultiplier > 1 = same for starves. Both default
   *  to 1.0. */
  feedMultiplier: number;
  starveMultiplier: number;
  /** Per-arc-id weight overrides for the random arc picker. Keys
   *  match content/beats/*.json id field. */
  arcWeights: Record<string, number>;
  /** Per-reincarnation-option-id weight overrides for the God
   *  picker. e.g. "lighthouse-daughter": 1.5 to push that option
   *  during a Lighthouse Vigil week. */
  optionWeights: Record<string, number>;
  /** Override turn cap. Null = use the default 10. */
  turnCap: number | null;
}

export const WEEKLY_THEMES: WeeklyTheme[] = [
  {
    id: "default-week",
    label: "An Ordinary Week",
    description: "Nothing in particular is calling.",
    ambientFlavor:
      "The week is unremarkable. The wyrm sleeps on. Doors open and close as they always do.",
    feedMultiplier: 1.0,
    starveMultiplier: 1.0,
    arcWeights: {},
    optionWeights: {},
    turnCap: null,
  },
  {
    id: "the-hungry-wyrm",
    label: "The Hungry Wyrm",
    description:
      "The Long Wyrm turned in its sleep. Feeds count for double; the world tilts toward its waking.",
    ambientFlavor:
      "The deep stone is warmer than it should be. Every chamber carries a faint smell of salt.",
    feedMultiplier: 2.0,
    starveMultiplier: 1.0,
    arcWeights: {
      "defend-the-deep": 1.5,
      "find-the-binder": 1.3,
    },
    optionWeights: {
      "iron-wyrm-hatchling": 1.5,
      "wyrm-touched-tome": 1.5,
      "wyrm-listening-stone": 1.5,
      "wyrm-shed-scale": 1.5,
      "wyrm-whispered-line": 1.5,
      "wyrm-glanced-stone": 1.5,
    },
    turnCap: null,
  },
  {
    id: "the-quiet-week",
    label: "The Quiet Week",
    description:
      "A held breath across the world. Hard moves come gentler; the turn cap loosens by two.",
    ambientFlavor:
      "Sounds carry less than they should. People speak more softly without deciding to. The wind has manners this week.",
    feedMultiplier: 0.5,
    starveMultiplier: 1.5,
    arcWeights: {
      "read-the-room": 1.5,
      "keep-the-warmth": 1.3,
    },
    optionWeights: {
      "monk-vowed": 1.5,
      "yesterday-nun": 1.5,
      "almost-pilgrim": 1.5,
      "lighthouse-keeper": 1.3,
      "lighthouse-daughter": 1.3,
    },
    turnCap: 12,
  },
  {
    id: "the-lighthouse-vigil",
    label: "The Lighthouse Vigil",
    description:
      "A keeping-watch week. Light + safety arcs more likely; healing-leaning options surface.",
    ambientFlavor:
      "Across the world, lamps that should not be lit are. Someone, in many places, has decided to keep watch.",
    feedMultiplier: 0.7,
    starveMultiplier: 1.4,
    arcWeights: {
      "keep-the-warmth": 1.6,
      "find-the-binder": 1.3,
    },
    optionWeights: {
      "wandering-candle": 1.5,
      "lantern-bog": 1.4,
      "faithful-shop-lantern": 1.5,
      "lighthouse-keeper": 1.6,
      "lighthouse-daughter": 1.6,
      "last-match-miner": 1.5,
    },
    turnCap: null,
  },
  {
    id: "the-hunting-moon",
    label: "The Hunting Moon",
    description:
      "Predators are bolder. Damage and harm count for more; the turn cap tightens.",
    ambientFlavor:
      "The animals have noticed something humans have not. They are quieter and they are everywhere.",
    feedMultiplier: 1.5,
    starveMultiplier: 1.0,
    arcWeights: {
      "survive-the-night": 1.6,
      "defend-the-deep": 1.3,
    },
    optionWeights: {
      "wounded-wolf": 1.5,
      "fox-cunning": 1.3,
      "snake-asleep": 1.3,
      "raven-broken-wing": 1.3,
      "bear-old": 1.4,
      "winter-crow": 1.3,
      "starveling-pup": 1.4,
    },
    turnCap: 8,
  },
  {
    id: "the-reading-week",
    label: "The Reading Week",
    description:
      "Books open of their own accord. Awareness-flavored options surface; knowledge arcs preferred.",
    ambientFlavor:
      "Pages turn in still rooms. Marginalia is fresh in places no one has been. Someone is taking notes.",
    feedMultiplier: 0.8,
    starveMultiplier: 1.2,
    arcWeights: {
      "find-the-binder": 1.7,
      "read-the-room": 1.4,
    },
    optionWeights: {
      "cursed-book": 1.6,
      "wyrm-touched-tome": 1.4,
      "wyrm-whispered-line": 1.4,
      "cartographers-ghost": 1.4,
      "scribes-table": 1.3, // not a real id; harmless if absent
      "monk-vowed": 1.3,
    },
    turnCap: null,
  },
  {
    id: "the-salt-tide",
    label: "The Salt Tide",
    description:
      "The salt cathedral hums. Coastal locations are more likely; wyrm-touched options bloom.",
    ambientFlavor:
      "Every well in the inland villages tastes faintly of salt this week. The wells did not used to.",
    feedMultiplier: 1.3,
    starveMultiplier: 1.0,
    arcWeights: {
      "find-the-binder": 1.4,
      "defend-the-deep": 1.4,
    },
    optionWeights: {
      "iron-wyrm-hatchling": 1.4,
      "wyrm-touched-tome": 1.4,
      "wyrm-listening-stone": 1.4,
      "wyrm-shed-scale": 1.6,
      "wyrm-whispered-line": 1.4,
      "wyrm-glanced-stone": 1.4,
      "lighthouse-keeper": 1.3,
      "shallow-water-whale": 1.5,
    },
    turnCap: null,
  },
  {
    id: "the-empty-door",
    label: "The Empty Door",
    description:
      "Places without people surface more. The forsaken village and hollow market loom.",
    ambientFlavor:
      "Someone has been leaving doors ajar. No one has been coming through them.",
    feedMultiplier: 1.0,
    starveMultiplier: 1.0,
    arcWeights: {
      "read-the-room": 1.7,
      "keep-the-warmth": 1.3,
    },
    optionWeights: {
      "cellar-door": 1.5,
      "ajar-funeral-gate": 1.5,
      "abandoned-keepsake": 1.4,
      "umbrella-forgotten": 1.4,
      "empty-porch-rocker": 1.4,
      "two-place-widower": 1.5,
    },
    turnCap: null,
  },
];

/** ISO week number for a date. Source-of-truth here so tests can
 *  pin specific weeks without depending on Date library quirks. */
export function isoWeekNumber(d: Date): number {
  // Algorithm: copy the date, set to nearest Thursday, year-base
  // Jan 4. ISO 8601 standard.
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
}

/** Compute the active theme for a Date, ignoring overrides. */
export function themeForDate(d: Date): WeeklyTheme {
  // Skip the default-week entry from rotation; use it only as the
  // "no rotation needed" anchor. Real rotation cycles the
  // remaining N-1 themes.
  const rotation = WEEKLY_THEMES.filter((t) => t.id !== "default-week");
  if (rotation.length === 0) return WEEKLY_THEMES[0];
  const week = isoWeekNumber(d);
  const idx = ((week % rotation.length) + rotation.length) % rotation.length;
  return rotation[idx];
}

/** Resolve the currently-active theme. Honors admin override
 *  stored in MetaArc.meta.themeOverride if present. */
export function activeTheme(arc: MetaArc | null): WeeklyTheme {
  const override = (arc?.meta as { themeOverride?: string } | null)
    ?.themeOverride;
  if (override) {
    const found = WEEKLY_THEMES.find((t) => t.id === override);
    if (found) return found;
  }
  return themeForDate(new Date());
}

/** Lookup-only — used by /god and tests. */
export function findTheme(id: string): WeeklyTheme | undefined {
  return WEEKLY_THEMES.find((t) => t.id === id);
}
