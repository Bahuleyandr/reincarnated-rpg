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
  /** Form-specific starting-room override. When set, the player
   *  wakes in this room instead of the location's entryRoomId.
   *  Used when the beat narrative requires a specific opening
   *  setting (e.g. cursed-book wakes in the spire-archive on a
   *  warm candle, not on the mid-landing). The room id MUST exist
   *  in the location; the projection initializer falls back to
   *  the location's default if the override is invalid. */
  startingRoomId?: string;
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
    // The book wakes mid-page on a warm-candled table — the
    // archive room. The mid-landing is for the climber forms.
    startingRoomId: "spire-archive",
  },
  // Phase-9 world: free-form arcs (no scripted beats yet). The
  // narrator drives. Including these as routes makes the cities
  // discoverable by `arcTagline` lookups even though pickArc
  // can return null for them — the tagline + flavor still helps
  // the run-start UI and the picker.
  {
    arcId: "the-spoke-square",
    formId: null,
    locationId: "caelum-by-the-wash",
    tagline:
      "You wake at the heart of the metropolis where the five rivers meet. Five roads radiate outward. Pick one.",
  },
  {
    arcId: "the-loom-square-morning",
    formId: null,
    locationId: "threadwarden",
    tagline:
      "The looms are speaking. A bolt is on display in the square. The master who wove it has perhaps a season left.",
  },
  {
    arcId: "the-pontoon-mile-tide",
    formId: null,
    locationId: "saltgale",
    tagline:
      "Low tide. The mudglass kilns are hot. A Branchman across the pontoon is watching you and has not yet decided what to charge.",
  },
  {
    arcId: "above-the-cloudline",
    formId: null,
    locationId: "highfield-ascending",
    tagline:
      "You wake on a windbench above the cloud-mass. A Topgrove offers cloudtea without comment.",
  },
  {
    arcId: "the-tide-out",
    formId: null,
    locationId: "the-coral-anchorage",
    tagline:
      "The tidal causeway is half-emerged. A Drowncaller eyes you. Dawn meal is over and the day is open.",
  },
  {
    arcId: "the-outer-quadrangle",
    formId: null,
    locationId: "the-long-indices",
    tagline:
      "You enter the outermost library quadrangle. Speech is permitted here. Each square inward is quieter.",
  },
  // Town arcs — short, flavor-led.
  {
    arcId: "the-pass-square",
    formId: null,
    locationId: "three-notches",
    tagline: "The pass is open. Bow at each notch on the way up.",
  },
  {
    arcId: "the-drying-slope",
    formId: null,
    locationId: "coldspoon",
    tagline: "The cloudtea is drying. The wind does the work.",
  },
  {
    arcId: "the-low-tide-walk",
    formId: null,
    locationId: "mudmoth",
    tagline: "The mud glows blue. Don't step in it barefoot.",
  },
  {
    arcId: "the-fen-edge",
    formId: null,
    locationId: "tallowfen",
    tagline: "The reeds are taller than you. The wax burns clean enough to write by.",
  },
  {
    arcId: "the-mill-courtyard",
    formId: null,
    locationId: "cataract-mile",
    tagline: "The mile of cataracts is loud. Conversation here is in hand-signs.",
  },
  {
    arcId: "the-silence-gate",
    formId: null,
    locationId: "quietmile",
    tagline: "Cross the silence-gate. Honor the vow.",
  },
  {
    arcId: "wheat-day",
    formId: null,
    locationId: "furrowmouth",
    tagline: "The market bell rings. Today is a single grain. The wholesalers know which.",
  },
  {
    arcId: "the-ropewalk",
    formId: null,
    locationId: "knots-landing",
    tagline: "The ropewalk is two hundred yards. The makers walk backward as the rope twists.",
  },
  {
    arcId: "the-bell-pier",
    formId: null,
    locationId: "briny-bell",
    tagline: "The bells are about to ring. The tide is on time.",
  },
  {
    arcId: "the-crab-pier",
    formId: null,
    locationId: "crab-by-crab",
    tagline: "Every crab on the coast in named tubs. Ask by name.",
  },
  // Per-form starting-room overrides for the new world.
  {
    arcId: "indices-hush-cursed-book",
    formId: "cursed-book",
    locationId: "the-long-indices",
    tagline: "You wake in the silent reading-room. A Hush-reader has not yet turned your first page.",
    startingRoomId: "the-hush-room",
  },
  {
    arcId: "anchorage-egg-galley",
    formId: "dragon-egg",
    locationId: "the-coral-anchorage",
    tagline: "You wake on the dawn-galley table. The halflings have just left the meal.",
    startingRoomId: "the-dawn-galley",
  },
  {
    arcId: "highfield-egg-cellars",
    formId: "dragon-egg",
    locationId: "highfield-ascending",
    tagline: "You wake banked in a cider cask. The Whitebark master will not look until first light.",
    startingRoomId: "the-cider-cellars",
  },
  {
    arcId: "tallowfen-core",
    formId: "dungeon-core",
    locationId: "tallowfen",
    tagline: "You wake at the bottom of a peat-pool. The reeds above you are taller than the sky used to be.",
    startingRoomId: "the-fen-edge",
  },
  {
    arcId: "keep-the-warmth",
    formId: "dragon-egg",
    locationId: "forsaken-village",
    tagline:
      "The smithy's hearth is dying and the village is empty. Keep your heartbeat alive long enough to be found.",
    // The egg sits in the smithy's banked hearth — Berra was
    // mid-stroke when she fled. Wakes in smith-house, not the
    // village-square the location defaults to.
    startingRoomId: "smith-house",
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
  // First arc for an ascended form. The Revenant returned to the
  // village to refuse, not to belong. Tonight someone they once
  // refused will ask again — first as a chapel bell, then in
  // person. Hold the watch and the refusal until dawn.
  {
    arcId: "refuse-the-bell",
    formId: "forsaken-revenant",
    locationId: "forsaken-village",
    tagline:
      "It is the third hour. The bell tolls a name you said no to once. They are walking up the road. Hold the watch.",
    // The Revenant wakes at the village-edge — the road is theirs,
    // per the form's opening prose. The chapel where the bell
    // tolls is reachable from there in one move.
    startingRoomId: "village-edge",
  },
  // The Still One sits at the silence-gate of Quietmile. A
  // visitor reaches the threshold with a name they cannot say
  // (vow of silence). The arc is whether to take the name into
  // remembrance or to withhold it. Both are valid. The sitting
  // is the test, not the choice.
  {
    arcId: "the-long-sit",
    formId: "the-still-one",
    locationId: "quietmile",
    tagline:
      "A visitor reaches the threshold of the place where you sit. They have brought a name they cannot say. Hold the silence; choose with weight.",
    startingRoomId: "the-silence-gate",
  },
  // The Salt Keeper finds a sour note in the dawn-cup before the
  // dawn bell. A young deacon will be down for services in three
  // hours and will taste it themselves if no work has been done.
  // Either cure the lot back to good or accept what the year
  // gave you. Either is a kept year.
  {
    arcId: "the-sour-pull",
    formId: "salt-keeper",
    locationId: "salt-cathedral",
    tagline:
      "The third barrel has gone sour overnight. The dawn bell is three hours out. Pull it back, or offer what the year was able to give.",
    startingRoomId: "side-chapel",
  },
  // The Chorister leads the pre-climb chant — the line of voice
  // that carries climbers up the switchback pass. Tonight's
  // party includes a child on their first crossing. Hold the
  // line through three notches; the chant carries them or the
  // wind does.
  {
    arcId: "the-pass-bowed",
    formId: "chorister-ascendant",
    locationId: "three-notches",
    tagline:
      "A child has joined the climbing party. Their voice is small. The line of chant must carry them up three notches before the wind takes any of you.",
    startingRoomId: "the-pass-square",
  },
  // The Rust-hand marks iron rings with slow controlled
  // weathering so the sea's quick corrosion can't find weakness
  // underneath. A halfling Drowncaller is here in person because
  // the last batch failed at sea. Mark the batch before dawn.
  {
    arcId: "the-joining",
    formId: "rust-hand-ascendant",
    locationId: "knots-landing",
    tagline:
      "The last batch of rigging rusted at sea. The Drowncaller has come up from the Anchorage. Mark the new batch before the morning barges.",
    startingRoomId: "the-ropewalk",
  },
  // The Deep-mark dives below the Coral Anchorage's seaward
  // platform, past the navy's rung-line, to retrieve a piece of
  // reef-iridium fallen from the living coral. The dive itself
  // is the work; depth is the point; either return is honored.
  {
    arcId: "the-deep-walk",
    formId: "deep-mark",
    locationId: "the-coral-anchorage",
    tagline:
      "A piece of reef-iridium has fallen past the navy's rung-line. Only you can reach it. The dive is the test; the depth is the point.",
    startingRoomId: "the-reef-edge",
  },
  // The Cantor distills eight layers of marginalia commentary
  // into a single verse the choir can carry. The Hush-readers
  // accept or reject the distillation by a single margin-mark.
  {
    arcId: "the-distilled-verse",
    formId: "cantor-of-the-long-song",
    locationId: "the-long-indices",
    tagline:
      "Eight layers of marginalia. One folio. One verse to carry it all. The Hush-readers will mark in three hours.",
    startingRoomId: "the-outer-quadrangle",
  },
  // The Garden-keeper handles the season's last pruning on the
  // Highfield orchards. The Topgrove elder's eye still knows
  // which branch goes; their hands no longer do. The Gust-
  // watcher signals when the wind permits the highest cuts.
  {
    arcId: "the-last-pruning",
    formId: "garden-keeper-of-the-spire",
    locationId: "highfield-ascending",
    tagline:
      "The season is turning. The autumn cuts must close the year. The elder will walk the rows beside you; the wind will say when.",
    startingRoomId: "the-windbench",
  },
  // The Furnace-warden holds the long-fire under the Coldspoon
  // tincture-room benches across an eight-hour cloud-bitters
  // extraction. The cold wind off the south slope tests the
  // banking. An apprentice watches their first long fire.
  {
    arcId: "the-long-fire",
    formId: "furnace-warden",
    locationId: "coldspoon",
    tagline:
      "The season's largest order is on the racks. The fire must hold the right red across eight hours of cold. An apprentice is watching.",
    startingRoomId: "the-tincture-room",
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

/**
 * Per-(form, location) starting-room override. Returns the
 * configured override room id, or null when no override applies.
 * The session bootstrap consults this to seed the projection's
 * starting room when a form has narrative-specific requirements
 * about where it wakes (cursed-book wakes in the archive, not
 * mid-landing).
 *
 * Callers should fall back to location.entryRoomId on null.
 */
export function pickStartingRoom(
  formId: string,
  locationId: string,
): string | null {
  const exact = ROUTES.find(
    (r) => r.formId === formId && r.locationId === locationId,
  );
  return exact?.startingRoomId ?? null;
}
