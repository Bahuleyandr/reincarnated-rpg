# Form × Race interaction (T5.4)

When a player wakes as a typed form (slime, cursed-book, dragon-egg,
dungeon-core) inside a racial homeland, the prose should respond
differently than it would in a race-agnostic location.

## Already shipped (Phase 9 wiring)

- `regionFlavorFor(locationId)` returns the race + voice +
  sub-populations + signature resources for any homeland or town
  in the atlas.
- `RemoteNarrator.regionFlavor` injects this as an ephemeral
  cache block alongside the form card. The narrator sees BOTH:
  - the form's negativeVocab + verbs + sample corpus
  - the region's race voice + sub-populations + signature goods
- `pickStartingRoom(formId, locationId)` already handles a few
  per-form starting-room overrides for the wedge cases:
  - cursed-book in sunless-spire → spire-archive
  - cursed-book in the-long-indices → the-hush-room
  - dragon-egg in forsaken-village → smith-house
  - dragon-egg in the-coral-anchorage → the-dawn-galley
  - dragon-egg in highfield-ascending → the-cider-cellars
  - dungeon-core in tallowfen → the-fen-edge

## What this guarantees in prose

Same form, different region, different prose:

- A **slime in collapsed-tunnel** narrates the slime's wedge
  (no body parts, no language) without regional voice — that's
  the original arc.
- A **slime in Saltgale** still observes the slime's negativeVocab,
  but elven Branchman NPCs around it speak in the act, the
  signature goods (mudglass, vellum, tidewater pearl) appear in
  ambient prose, and the regionFlavor block tells the narrator
  to keep the local voice consistent.
- A **cursed-book in the-long-indices** wakes in the Hush Room.
  The dialogue.exchanged tool, when called, surfaces its replies
  as marginalia in a folio — the orcish writing-priority rule
  shapes how the book's reply propagates.

## Form-specific recommendations per region

The narrator handles this implicitly via the regionFlavor block.
The recommendations here are documentation for content authors:

| Form         | Highfield     | Saltgale      | Long Indices | Threadwarden | Anchorage    |
|--------------|---------------|---------------|--------------|--------------|--------------|
| Slime        | melts in cold | elven slang   | quiet        | named cloth  | salt-cure    |
| Cursed Book  | wind-paged    | contract-bound| Hush-read    | Pageborn-met | flag-signal  |
| Dragon Egg   | hearth-sat    | tide-rocked   | shelf-tucked | smithy-banked| galley-warm  |
| Dungeon Core | terrace-shaped| pontoon-set   | nested-quad  | basin-sunk   | reef-bound   |

These are flavor hints, not mechanics — the narrator picks them
up from the regionFlavor block + the form card together.

## Future work (not in T5.4)

- Race-specific NPC reactions to typed forms: a Topgrove who
  finds a dragon-egg in their banked cider-cask reacts
  differently than a halfling Reef-cutter. Encoded as
  `npcReactsTo[formId]` in the NPC template.
- Form-specific homeland affinities: e.g. a cursed-book is
  +20% more likely to surface in the Long Indices via the
  picker. Already partially via the daily challenge pool;
  could be expanded to the general picker.
