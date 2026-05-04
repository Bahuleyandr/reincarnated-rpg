# Year 2 narrative scaffold (T5.7)

The Phase-7 365-day calendar shipped Year 1 (Books I-III + Year
Archive). Year 2 isn't authored yet. Below is the scaffold —
the shape of how the second year would land, given the
five-spoke world atlas + the four factions + the Long Wyrm meta-arc.

## Theme

**Year 1's question:** what is the cycle?
**Year 2's question:** what does the cycle owe us?

Year 2 is a regional tour. Each month centers a single spoke
or a cross-spoke arc. Players who pledged factions in Year 1
see Year 2 through that lens; ascended players appear as
recurring NPCs in others' Year 2 runs.

## Books / months (12)

| Month | Region focus           | Theme                      | Faction lean      |
|-------|------------------------|----------------------------|-------------------|
| IV    | Highfield Ascending    | The Frost That Came Twice  | Choristers        |
| V     | Coldspoon ↔ Long Indices | What the bitter teaches  | Idle              |
| VI    | The Long Indices       | The Sentence Broken        | Idle / Forsaken   |
| VII   | Quietmile ↔ Caelum     | When silence travels       | mixed             |
| VIII  | Caelum-by-the-Wash     | The Five Quarters Mix      | mixed             |
| IX    | Mudmoth ↔ Saltgale     | The Audit (deeper)         | Rust Hand         |
| X     | Saltgale               | The Act Drops              | Rust Hand         |
| XI    | Tallowfen ↔ Knot's Landing | What burns clean       | Rust Hand / Choristers |
| XII   | Threadwarden           | The Cloth That Outlasts    | Choristers        |
| I     | Furrowmouth ↔ Caelum   | The Right Day              | Choristers        |
| II    | Briny Bell ↔ Crab-by-Crab | Tides Without Cause     | Forsaken          |
| III   | The Coral Anchorage    | The Four Ribbons           | Forsaken          |

Each month = 4 chapters = 4 weeks (matching the Phase-7 cadence).

## Branch decisions

Year 2 introduces 5 new branch decisions, each tied to a region:

1. **The Frost That Came Twice** (Highfield) — does the player
   help the Topgroves replant or convince them to take the loss
   gracefully?
2. **The Sentence Broken** (Long Indices) — the Hush-reader Vohn
   may speak again. Does the player encourage or honor the silence?
3. **The Audit Deepens** (Saltgale) — when Branchmen are caught
   off-act for the first time in twenty years, does the player
   expose the act or keep its secret?
4. **The Wrong Tide** (Coral Anchorage) — when Tide Without
   Cause arrives 2 weeks early, does the player stand watch
   with the Drowncallers or refuse the Forsaken affinity?
5. **The Last Bolt** (Threadwarden) — when Master Juniper dies
   mid-bolt, does the player honor the apprentice's claim or
   side with the cross-craft challenger?

## Endings

Year 2 has 4 endings (vs Year 1's 6), all shaped by Year 1's
choices:

- **The Cycle Owes Nothing**: idle/forsaken-leaning conclusion;
  the world holds its breath and continues.
- **The Cycle Owes Everything**: chorister-leaning; a great
  reconciliation across the spokes.
- **The Cycle Is Iron**: rust_hand-leaning; an industrial
  awakening that some welcome and some grieve.
- **The Cycle Quiets**: orc-mediated; the year ends in a
  marginalia conversation between all five races.

## Authoring path (when ready)

- `content/story/chapters/13.json` through `48.json` (36 new
  chapter files; one per chapter-week of Year 2).
- `content/story/branches/4.json` through `8.json` (5 new
  decisions).
- `content/story/voices/` adds 5 new voices keyed to the regional
  guides.
- `content/story/endings/year-2-*.json` (4 endings).

## Status

**Scaffold only.** No chapters authored. Phase-7 tooling (story
admin dashboard, story authoring CLI) is ready to consume Year
2 content the moment it's written. The world atlas + race
files + faction map make Year 2 cheaper to author than Year 1
was — most of the texture already exists.
