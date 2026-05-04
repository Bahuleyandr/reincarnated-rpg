# Story Bible — Year One

**Status**: design doc. Implementation planned in `POST_MVP_PLAN.md` Phase 7. Lore content lives in `content/story/`.

A 365-day persistent campaign. The world has a spine; players are free to walk it, branch from it, or break it. Every major decision is made by the *aggregate* of player actions across all runs — the storyline bends to the world's will, not any single player's.

## Premise

The world is called **Yssa-Wyrm**, a single river-realm wound around the body of the sleeping **Long Wyrm**. The Wyrm's breath is the cycle of reincarnation: when a soul dies, the Wyrm exhales it into a new form. When the Wyrm sleeps, the cycle holds. When it stirs, lives become strange.

There has been an Age before. The **Age of Names** ended when the previous Wyrm devoured itself; the current Wyrm hatched from those bones a thousand years ago. Scholars call this the **First Mercy**. For most of the new Wyrm's sleep, the world settled and forms multiplied. But for the last hundred years, the Wyrm has stirred in dreams — earthquakes, prophecies, the moon turning the wrong color.

In Year 1 of the players' arrival, the stirring has reached every soul. The cycle is loosening. Reincarnations come more strangely. Some deaths leave echoes that surface lives later (foreshadowing memory plants). Some forms carry scars from lives they never lived (legacy traits). The world's mortals — the players — must decide what comes next.

Three paths are visible:

- **Wake the Wyrm.** A new Age begins, the cycle is reforged, but the world reshapes itself in the new Wyrm's image. The Choristers want this.
- **Kill the Wyrm.** The cycle ends. No more reincarnation; one life, then nothing. A world of mortal weight. The Rust Hand wants this.
- **Tend the world as it is.** Neither wake nor kill. Hold the broken cycle steady. The Idle want this.

A fourth path exists, but only the Forsaken speak of it: **slip the cycle entirely**. Those who manage it become permanent — their final form, their last words.

## Cosmology

- **The Long Wyrm**: a continental-scale entity, half-buried beneath the ground. Its scales are mountain ranges; its breath is the world's weather. It is *not a god* — it is a mechanism. But mechanisms in Yssa-Wyrm dream.
- **The Cycle**: the rule that all souls reincarnate when their form dies. Memory carries imperfectly; some lives remember others through scars and echoes. The Cycle is enforced by the Wyrm's slow breath.
- **The Hollow Throne**: the empty seat of the previous Wyrm. Located in a cavern beneath the world. To sit it is to claim the next Age — but no mortal has ever sat it and remained mortal.
- **Form Drift**: as the Cycle weakens, forms blur. Slimes shimmer with void. Dragon-eggs hatch wrong. Cursed Books open to pages they did not contain. This intensifies through the year.
- **Echoes**: when something significant happens, the world remembers it imperfectly. A future life feels its weight before knowing why.
- **The Witness**: a single ancient figure who has lived through the previous Age. May be a god, may be a survivor, may be a metaphor. She who watches.

## The Year at a Glance

| Book | Months | Title | Theme |
|---|---|---|---|
| I | M1 | **Ember** | The Stirring — strange omens, prophecy unraveling |
| II | M2 | **Smoke** | The Whispers — factions form, players choose sides |
| III | M3 | **Frost** | The First Breach — reality cracks, void enters |
| IV | M4 | **Bloom** | The Unburied — echoes multiply, the dead linger |
| V | M5 | **Tide** | The Mother's Voice — antagonists ascend, faction wars |
| VI | M6 | **Pyre** | The First Awakening — Wyrm half-wakes; mid-year climax |
| VII | M7 | **Ash** | The Reckoning — aftermath, world reshapes |
| VIII | M8 | **Ember II** | The Long Path — quieter, mastery, deeper bonds |
| IX | M9 | **Veil** | The Forgotten Names — world forgets itself |
| X | M10 | **Hollow** | The Empty Throne — power vacuum |
| XI | M11 | **Storm** | The Final Counsel — votes, alliances, betrayals |
| XII | M12 | **Crown** | The Inheritance — endings, Year Two seed |

Each Book is one calendar month (~30 days). Each Book contains four Chapters of roughly one week each.

## The 48 Chapters

Each chapter has a **theme**, a **world event** (something that happens regardless of player action), and an optional **branch decision** (a major fork shaped by aggregate player contribution). Branch decisions are listed only at the chapters where they matter; most chapters drift.

### Book I — Ember: The Stirring

**Ch 1: Strange Omens** (Days 1-7)
The moon turns red for an hour every night. Animals flee inland. Slimes pulse to a rhythm no one set. Players' famous deaths in this week become the seeds of the year's lore — the first deaths matter more.
- *World event*: the **Red Moon** — narrator weaves this into all narration this week. Roll modifier −1 at night for any form.
- *Memory plants*: many. Future weeks will surface what happened here.

**Ch 2: The First Tremor** (Days 8-14)
An earthquake opens an old shrine in the **Whispering Marrow**, a network of bone-white catacombs. Within: a hand-cuff carved with an unknown sigil. Anyone who touches it sees a vision of a face they don't know yet.
- *World event*: a new location, **Whispering Marrow**, becomes accessible.
- *Cipher* (the Twins, Cinder's sister) appears for the first time. Lawful. Asks careful questions.

**Ch 3: The Prophet's Last Breath** (Days 15-21)
**Old Bone, the Last Wyrm-Speaker**, dies on day 18. Her dying words are the seeds of every prophecy that will play out this year. Players who happen to be in her location at the right moment receive a fragment of her vision (a permanent legacy trait: *"prophet-touched"*).
- *World event*: Old Bone's death is permanent canon. She does not reincarnate. Her death is the first **Famous Death** that everyone in Yssa-Wyrm hears about.

**Ch 4: Council of Three** (Days 22-30) — **BRANCH I**
The three faction leaders converge on **Iron-Reach** to discuss the omens. The Council's outcome depends on player contribution to each faction's preparations.
- *Branch I*: which path opens?
  - **A: Unity** — players push all three factions toward cooperation. Council holds. Year develops slowly with all factions playing rough cooperation.
  - **B: War** — players push factions to escalate. Council fails. Faction conflict dominates the year; raid mechanic intensifies.
  - **C: No Council** — players ignore. Council attendees murdered en route. The Twins' faction (the Forsaken) emerges into visibility. Most chaotic path.
- *Default if unmet*: B.

### Book II — Smoke: The Whispers

**Ch 5: Cults Take Shape** (Days 31-37)
Faction recruitment opens. Each faction's NPC trainers offer slight bonuses to aligned players. Skill XP gain in faction-aligned crafts +10%.
- *World event*: factions become joinable via a `pledge_faction(factionId)` tool that costs 50 coins and is tracked on `users.faction`.

**Ch 6: The Twins Speak** (Days 38-44)
**Cipher** and **Cinder** appear at opposite ends of the world on the same day. Both deliver the same prophecy in different words: *"the Wyrm dreams of seven, and seven is one of you."*
- *World event*: a daily quest opens — *"interpret the Twins' prophecy"* with seven possible answers; each answer pulls the world toward a different Book VI outcome.

**Ch 7: The First Defection** (Days 45-51)
A noted faction NPC publicly switches sides. *Which* NPC depends on which faction has the most player members at this point.
- *Default*: a Chorister noble named **Halvis** joins the Rust Hand.

**Ch 8: The First Ritual** (Days 52-60) — **BRANCH II**
Each faction performs its ritual at week's end. The strongest ritual succeeds; the others scatter their participants. Strength = sum of player contributions to that faction in Books I-II.
- *Branch II*: which ritual succeeds?
  - **A: Choristers' Hymn of Calling** — the Wyrm stirs slightly closer to waking.
  - **B: Rust Hand's Severing Rite** — the Wyrm's connection to the Cycle weakens; reincarnation grows more chaotic.
  - **C: Idle's Stillness** — both other rituals are dampened; the world stabilizes.
- *Default if no ritual reaches threshold*: D — all rituals fail, mass disillusionment, faction membership drops 30%.

### Book III — Frost: The First Breach

**Ch 9: Reality Cracks** (Days 61-67)
A fissure opens in the **Sleeping Coast** region. Strange creatures — *void-stained* — emerge. Forms reincarnated this week have a 20% chance of being void-stained variants (cosmetic + +1 stat to a random skill, +1 vulnerability to any attack from a Choristers source).
- *World event*: void-stained variants enter the catalog. Some are permanent for that run.

**Ch 10: New Craft** (Days 68-74)
**Void-shards** appear in the resource pool — only gatherable by void-stained forms or by players who have learned the new skill **voidwork** from the new NPC trainer **Ssel'mek the Glassblown** in the Sleeping Coast.
- *World event*: voidwork added to skill catalog. New recipes unlock: void-glass armor, void-tipped weapons, void-bound contracts.

**Ch 11: Iron-Reach Falls** (Days 75-81)
The economic capital is sacked. By whom depends on Branch I + II.
- If Branch I=B (War): Rust Hand opportunists.
- If Branch I=A (Unity): void-creatures break through.
- If Branch I=C: the Twins announce themselves and claim the city.
- *World event*: Iron-Reach's NPC vendors disperse. Coin economy temporarily inflated as the central-bank prices destabilize. Phase 5 telemetry surfaces this as a real event.

**Ch 12: The Witness Speaks** (Days 82-90) — **BRANCH III**
The Idle leader, known only as **The Witness**, breaks centuries of silence. She delivers a single line whose meaning differs based on player action.
- *Branch III*:
  - **A: She speaks of mercy** — heals 30% of the year's accumulated bad_luck across all players. Triggered by aggregate Idle membership.
  - **B: She speaks of warning** — names the Mother of Rust as a danger to the Cycle. Triggered by Branch II = A.
  - **C: She is silent** — the Idle faction loses members. Triggered by Branch II = B or D.

### Book IV — Bloom: The Unburied

**Ch 13: The Echoes Multiply** (Days 91-97)
Foreshadowing memory plants intensify across all players. Echo memories surface 30% more often. Some echoes belong to *other players' lives*, not the player's own — their first hint of a shared world memory.

**Ch 14: A Slime Becomes a Memory** (Days 98-104)
A famous slime death from Book I returns as an NPC: **the Slime That Remembered**. They claim to be that exact slime — and they are. Some echo took root.
- *World event*: a recurring NPC born from player action. Their personality is generated from the original death's narration via a one-time Sonnet 4.6 prompt.

**Ch 15: The Forsaken Are Seen** (Days 105-111)
A figure clad in salt and silence walks into a town meeting and announces: *"we are the fourth voice. we will not vote. we will not breathe with the Wyrm. we are already dead."* This is the public reveal of **the Forsaken** faction.

**Ch 16: The First Crossing** (Days 112-120) — **BRANCH IV**
Will the Council give the Forsaken a place at future votes?
- *Branch IV*:
  - **A: They are heard** — Forsaken faction joinable. Permadeath option offered to players (with cosmetic + lasting-form benefits).
  - **B: They are shunned** — Forsaken go underground. Their work happens silently. Players can still ally privately.
  - **C: They are hunted** — most extreme path. Triggered by aggressive aggregate action against early Forsaken NPCs.

### Book V — Tide: The Mother's Voice

**Ch 17: Rhozell Returns** (Days 121-127)
**Rhozell, the Wyrm's Hand**, ascends — no longer just a recurring lieutenant but an avatar of the Wyrm's intent. He appears in any player's run with grudge memory across runs (already planned in Phase 5.5 Day 34-35).
- *World event*: Rhozell's appearance probability doubles for the rest of the year.

**Ch 18: The Mother of Rust Walks** (Days 128-134)
**Mhirosh Rust-Tongue, Mother of Rust**, becomes an active world figure. She personally appears in player runs in Rust Hand-aligned regions. Charismatic, terrifying, occasionally tender.
- *World event*: a third recurring NPC enters the rotation alongside Rhozell and Cipher.

**Ch 19: Faction Borders Burn** (Days 135-141)
Cross-faction wars peak. Travel between regions costs more energy. Coin flow distorts: Phase 5 telemetry shows obvious inflation in Choristers regions, deflation in Rust Hand regions.
- *World event*: regional currency adjustments. Vendor catalogs shift.

**Ch 20: The Long Wyrm Stirs** (Days 142-150) — **BRANCH V**
The world boss raid (Phase 4 Day 13) intensifies. The aggregate damage dealt to the Wyrm during Books I-V determines whether it stays asleep or half-wakes early.
- *Branch V*:
  - **A: Stays Asleep** — damage below threshold. Book VI opens quietly.
  - **B: Half-Wakes** — damage above threshold. Book VI opens with a continent-shifting earthquake.
  - **C: Wakes Fully (early)** — damage way above threshold. The mid-year climax fires three weeks early; Book VI is compressed into one chapter; the rest of the year is the aftermath.

### Book VI — Pyre: The First Awakening (mid-year climax)

**Ch 21: A Continent Shifts** (Days 151-157)
The Wyrm's flank breaks the surface. A new region opens: **the Wyrm's Exposed Scales**, a vast mountain range that wasn't there a week ago. New resources, new locations, new NPC tribes that have lived on the Wyrm's hide for generations.
- *World event*: 7 new locations + 4 new resource items + 1 new skill (*scaleweaving*).

**Ch 22: The Hand Splits** (Days 158-164)
Rhozell's faction splinters. A breakaway sect — **the Patient Hand** — emerges. They want the Wyrm to wake but slowly, with mortal preparation. Rhozell's relationship with this sect is hostile.
- *World event*: a new sub-faction with its own trainer NPC and unique recipes.

**Ch 23: The First Wonder** (Days 165-171)
A world-event wonder that affects every player simultaneously: for one full day, the Wyrm exhales a **Voice** that can be heard in every form's narration. A single sentence delivered to every player at the same UTC moment. The sentence is randomized once per player based on form + faction.
- *World event*: synchronized narration injection. Cheap (one Haiku call per player to format the line).

**Ch 24: The Pyre** (Days 172-180) — **BRANCH VI (mid-year climax)**
The biggest branch of the year. The world chooses how to respond to the Wyrm's stirring.
- *Branch VI*:
  - **A: The Lulling** — players collectively pour resources into a Choristers ritual that puts the Wyrm back into deep sleep. Year continues quietly.
  - **B: The Severing** — players pour resources into a Rust Hand rite that severs the Wyrm from the Cycle. Reincarnation becomes optional (permadeath unlocked for all).
  - **C: The Witnessing** — players pour resources into the Idle vigil. Status quo holds; the Wyrm half-wakes but does not change the world.
  - **D: The Inversion** — secret outcome. Triggered if no faction reaches threshold AND Forsaken aggregate participation is high. Players themselves become the Wyrm-in-waiting.

### Book VII — Ash: The Reckoning

**Ch 25: After the Pyre** (Days 181-187)
Quiet. NPCs grieve. Famous deaths from the Pyre week become permanent monument lore. New player runs entering this week start with a 1-line narrative reference to the Pyre's outcome ("you remember the day the world chose").

**Ch 26: The Last Cantor** (Days 188-194)
**Aelnea Vren** falls or ascends, depending on Branch VI:
- VI=A: she ascends to High Cantor of the new sleeping age.
- VI=B: she dies of grief.
- VI=C: she retreats to a hermitage and becomes a recluse NPC.
- VI=D: she is the first to recognize what the players have become; she kneels.

**Ch 27: New Regions Bloom** (Days 195-201)
Player-explored territory expands as the world rebuilds. Notes left in surviving locations become canonical local legends — the Day 32-33 player notes mechanic gets retroactive promotion: top-voted notes from before the Pyre become *engraved* (permanent, votes locked).

**Ch 28: The Realignment** (Days 202-210) — **BRANCH VII**
Faction realignment based on Pyre outcome.
- *Branch VII*: which faction grows, which shrinks.
- *Default*: faction sizes shift by 20-50% based on Pyre.

### Book VIII — Ember II: The Long Path

**Ch 29: Mastery** (Days 211-217)
Player skills hit their high-level recipes. New gates open: smithing 15 unlocks Wyrm-scale armor. Alchemy 12 unlocks rebirth potions. Most players are not yet at these levels — a small elite emerges.

**Ch 30: Companions Speak** (Days 218-224)
Bonded NPCs (Phase 2 Day 7-8) receive their own arcs. Each companion has a personal quest the player can choose to pursue.

**Ch 31: The Coin Flows Different** (Days 225-231)
Phase 6a (the player marketplace) goes live in-fiction. Iron-Reach (whatever's left of it) reopens as a player-driven market.

**Ch 32: The New Coin** (Days 232-240) — **BRANCH VIII**
Who controls the new economy?
- *Branch VIII*:
  - **A: The Idle** — economy stabilized via central-bank dampening. Marketplace fees high.
  - **B: The Choristers** — economy favors faction-loyal traders. Aligned players get fee discounts.
  - **C: The Rust Hand** — economy is anarchic. No fees, no protections. Caveat emptor.
  - **D: The Forsaken** — silent markets. Trades anonymous. Smuggling thrives.

### Book IX — Veil: The Forgotten Names

**Ch 33: The Lore Decays** (Days 241-247)
World lore decay rate doubles. Old `world_lore` entries fade faster. Famous deaths from Books I-V begin to vanish unless players actively re-witness them (visit the location where they happened).

**Ch 34: Personal Memory Becomes Public** (Days 248-254)
Player-written notes and epitaphs are promoted: high-vote ones become canonical lore. The Day 30 epitaph mechanic gets a permanent role.

**Ch 35: A City Forgets Itself** (Days 255-261)
**Iron-Reach** (or what replaced it) loses its name in half its citizens' memory. Players in the location must invent a new name; majority-coined name wins by week's end and is canonized.

**Ch 36: The Recovery** (Days 262-270) — **BRANCH IX**
Rebuild the forgotten, or let them fall?
- *Branch IX*:
  - **A: Rebuild** — players collectively restore lost lore via in-game actions. The world remembers more.
  - **B: Let it fall** — the world becomes lighter, harder to navigate. Bonus: new players entering Year 1 find a less-crowded world. Cost: veterans lose memory anchors.

### Book X — Hollow: The Empty Throne

**Ch 37: The Throne Is Found** (Days 271-277)
The **Hollow Throne** becomes accessible via a quest chain that requires faction alignment + skill prerequisites + a relic (the hand-cuff from Ch 2's shrine, which has been an inventory item the whole year for early-Book-I players who picked it up).

**Ch 38: A Player Sits** (Days 278-284)
The first player to reach and sit the Hollow Throne is recorded in eternal lore. Their username + form + faction become canon. They earn the unique title **"The First to Sit"**.
- *World event*: only one player gets this. The race is real and observable.

**Ch 39: Edicts** (Days 285-291)
Players whose faction holds territory can promote their player notes to *Edicts* — local laws that affect that location's mechanics (e.g., an Edict could grant +1 to gather rolls in that location, or forbid violence).

**Ch 40: The Throne Speaks** (Days 292-300) — **BRANCH X**
The Throne asks something of the world.
- *Branch X*: a single question is posed. Players collectively answer.
  - The question is *generated* from the year's accumulated state — most-broken faction's grievance, most-celebrated player's choice, etc.
  - The answer locks in for Book XI.

### Book XI — Storm: The Final Counsel

**Ch 41: All Factions Gather** (Days 301-307)
Even the Forsaken send a delegate (silent, salted). The Counsel convenes at **the Cantor's Hollow** or **the Rust Pits** depending on Branch I-VI dominant outcomes.

**Ch 42: The First Vote** (Days 308-314)
**Vote 1**: *should the Wyrm wake?*
- Vote tally = sum of player contributions across the year, weighted by faction.
- Result locks for Book XII.

**Ch 43: The Second Vote** (Days 315-321)
**Vote 2**: *who shall sit the Hollow Throne?*
- Tally = combined faction loyalty + the First-to-Sit player's choice.

**Ch 44: The Third Vote** (Days 322-330)
**Vote 3**: *what becomes of the Cycle?*
- Tally = aggregate of all player ascensions, permadeath choices, and faction membership.

### Book XII — Crown: The Inheritance

**Ch 45: The Wyrm Decides** (Days 331-337)
The Wyrm makes its final choice based on the three Votes.

**Ch 46: The World Ends/Changes/Holds** (Days 338-344)
The world reshapes. NPCs respond. Famous deaths from across the year are recited at the **Pyre of Names** in a single global event lasting one real-time hour.

**Ch 47: The Players Become** (Days 345-351)
Players' final form (the form they're in at end of Year 1) becomes their *lasting form* — the form they'll re-emerge in for Year 2. Ascendant forms are eligible. Forsaken players who have permadied keep their slot.

**Ch 48: The Year Ends** (Days 352-365)
Multi-day denouement. The world rests. Year 2 begins on Day 366 with all of Year 1's choices baked in as the new starting state.

## Endings

Endings are determined by the three Votes + cumulative state. Five primary endings + one secret:

### Renewal (Choristers won + Wyrm woke)
The new Age begins. The Wyrm speaks for the first time in a thousand years and *names* the players' contributions. Players' famous deaths become the founding myths of the new Age. Year 2 forms are rebalanced — slimes become *Wyrm-blessed slimes*, books become *Cantor-tongued books*, etc. The world is louder, brighter, more structured.

### Echo (Rust Hand won + Wyrm killed)
The cycle ends. No more reincarnation. Players who haven't reached ascension before this ending become permanent in their final form — but only one form per soul, ever again. New players entering Year 2 do so under the **Mortal Compact**: one life, then nothing. The world is sparser, harder, more precious.

### Hollow (Idle won OR no faction reached threshold)
Status quo persists. The Wyrm sleeps shallowly. The Cycle continues but loose. Year 2 is similar to Year 1 with shifted lore and faction balance. The most common ending; the one the system defaults to if players don't push.

### Mortal (Forsaken won, requires Branch IV=A)
A hybrid world. Players who chose the Forsaken path are permanent; players who didn't continue under the Cycle. Two parallel populations. The marketplace fragments. New mechanics: permanent-form players can be hired by Cycle-bound players for irreversible favors.

### Inversion (secret — requires Branch VI=D)
Players themselves become the next Wyrm. The world's memory becomes their memory. Year 2 begins with the players, collectively, dreaming the world into being. Mechanics shift: every player's narration tints the world's lore for everyone else.

### Long Sleep (failure ending)
If aggregate engagement collapsed (fewer than ~100 active players in Books X-XI), the Wyrm sleeps deeper than ever and the world stills. Year 2 begins as a near-clone of Year 1's beginning. This is the "everyone left, the world reset" ending.

## Factions

### The Choristers
- *Belief*: the Wyrm should wake fully. A new Age must begin. The cycle is sacred and must be reforged.
- *Aesthetic*: lawful, ritualistic, choral. White and gold. Stone shrines, deep mountain hollows.
- *Leader*: **Aelnea Vren, High Cantor of the Cantor's Hollow.**
- *Perks for aligned players*: +10% XP in alchemy, smelting, smithing. Discounts at Choristers vendors. Access to Choristers-only recipes (rebirth potions, song-bound wards).
- *Iconic NPCs*: Halvis (early defector), Cendra Dawn-Mouth (musician), Brother Ot (Cantor's Hollow gatekeeper).

### The Rust Hand
- *Belief*: the Wyrm should be killed. Reincarnation is a yoke. One mortal life is enough.
- *Aesthetic*: outlaw, militant, iron-and-ash. Crimson and oxide. Ruined surface forts, Rust Pits.
- *Leader*: **Mhirosh Rust-Tongue, Mother of Rust.**
- *Perks for aligned players*: +10% XP in mining, woodcutting, voidwork. Black-market access. Rust Hand-only recipes (sever-blades, anti-Wyrm sigils).
- *Iconic NPCs*: Rhozell (the Wyrm's Hand — turns Rust Hand fully by Book V), Vekka the Knife, the Twins (initially Rust Hand-aligned).

### The Idle
- *Belief*: tend the world as it is. Neither wake nor kill. Stillness is a kind of love.
- *Aesthetic*: hermits, scholars, naturalists. Green and grey. The Witness Tree, Herb-Glade, the Marrow's quiet wings.
- *Leader*: **The Witness** — ageless, female, may be a survivor of the previous Age.
- *Perks for aligned players*: +10% XP in farming, cooking, fishing. Healing services from Idle NPCs at half cost. Idle-only recipes (long-tea, witness-leaves, peace-bound mantles).
- *Iconic NPCs*: Mother Vael (alchemy trainer, Idle-aligned), Old Lod (witness-tree gardener), the Watcher Twins (sub-NPCs of the Witness).

### The Forsaken
- *Belief*: slip the cycle. End reincarnation for self alone. Become permanent.
- *Aesthetic*: salt, silence, shrouds. Pale and translucent. The Eyeless Tower.
- *Leader*: not a person but a *condition* — anyone who has slipped the cycle is, by definition, Forsaken. They have a council of seven anonymous voices.
- *Perks for aligned players*: permadeath option (unlocked after Branch IV=A). Forsaken-only recipes (salt-bound contracts, silence-glass, shrouds of last leave).
- *Iconic NPCs*: the Salt-Tongue (first public Forsaken figure, appears Ch 15), the Eye in the Tower (a permanent NPC who is one of the council).

## Major Recurring NPCs

| Name | Faction | Role | First Appearance | Recurring Behavior |
|---|---|---|---|---|
| **Old Bone, the Last Wyrm-Speaker** | Idle | the dying prophet | Ch 3 | Dies. Becomes lore reference in every subsequent week. |
| **Aelnea Vren, High Cantor** | Choristers | faction leader | Ch 4 | Recurs at every Council; arc resolves Ch 26 by Branch VI. |
| **Mhirosh Rust-Tongue, Mother of Rust** | Rust Hand | faction leader | Ch 18 (referenced earlier) | Personal appearance in Rust-aligned runs from Book V on. |
| **The Witness** | Idle | faction leader | Ch 12 | Speaks once per Book maximum. Each utterance is canon. |
| **Rhozell, the Wyrm's Hand** | Choristers (Book V: Wyrm-direct) | recurring antagonist | Ch 17 (Phase 5.5 Day 34-35) | Cross-run grudge memory; appearance probability scales with year progress. |
| **Cipher** | Forsaken (revealed Book IV) | one of the Twins | Ch 2 | Appears once per Book asking a question; her questions seed branches. |
| **Cinder** | initially Rust Hand, later split | Cipher's sister | Ch 6 | Mirrors Cipher; if Cipher asks, Cinder answers (or vice versa). |
| **Halrik, Master Smith of Iron-Reach** | neutral | smithing trainer | Day 1 (always available) | Becomes a refugee Ch 11; his location depends on which faction sacked Iron-Reach. |
| **Mother Vael of the Herb-Glade** | Idle | alchemy trainer | Day 1 | Stays put. Her location remains a sanctuary all year. |
| **Ssel'mek the Glassblown** | unaligned | voidwork trainer | Ch 10 | Appears in the Sleeping Coast post-Breach. |
| **the Salt-Tongue** | Forsaken | first public Forsaken | Ch 15 | Returns as Forsaken delegate in every subsequent Council. |
| **the Slime That Remembered** | unaligned | recurring memory-NPC | Ch 14 | Born from a player's famous death in Book I. Their personality reflects that exact run. |
| **Old Lod, the Witness-Tree Gardener** | Idle | quiet wise elder | Day 1 | Tends the tree all year. Speaks rarely but truly. |
| **Brother Ot, Cantor's Hollow gatekeeper** | Choristers | low-rank but seen often | Ch 5 | Provides the most quotes per year. Often mistakenly trusted by players. |
| **the Twins of the Witness** | Idle (sub) | watchers of watchers | Ch 12 | Whisper to high-Idle-loyalty players in their dreams. |

## Branch Decisions Catalog

A summary table of all 10 major branches. Each is decided by *aggregate* player contribution measured at the chapter's end. Defaults fire when no path reaches threshold.

| # | Chapter | Question | Paths | Threshold metric |
|---|---|---|---|---|
| **I** | Ch 4 | Council outcome | Unity / War / No Council | Player-attendance + faction-prep contributions |
| **II** | Ch 8 | Which ritual succeeds? | Hymn / Severing / Stillness / All Fail | Per-faction ritual contribution |
| **III** | Ch 12 | What does the Witness say? | Mercy / Warning / Silence | Aggregate Idle membership × II outcome |
| **IV** | Ch 16 | Forsaken at the Council? | Heard / Shunned / Hunted | Aggregate Forsaken-aligned actions |
| **V** | Ch 20 | Wyrm raid outcome | Asleep / Half-Wakes / Wakes Early | Cumulative damage to Long Wyrm HP |
| **VI** | Ch 24 | The Pyre — mid-year climax | Lulling / Severing / Witnessing / Inversion | Per-faction ritual + Forsaken total |
| **VII** | Ch 28 | Faction realignment | (calculated) | Post-Pyre aggregate |
| **VIII** | Ch 32 | Who controls the economy? | Idle / Choristers / Rust / Forsaken | Marketplace volume by faction |
| **IX** | Ch 36 | Lore — rebuild or let fall? | Rebuild / Fall | Aggregate lore-restoration actions |
| **X** | Ch 40 | The Throne's question | (generated) | Year-state synthesis |

Plus the three end-of-year **Votes** (Ch 42-44), which collapse all prior branches into the final ending.

## Year Two Seed

Year 2 (Days 366-730) begins with Year 1's state baked in:
- The Wyrm's disposition (woke / killed / slept / inverted) is canon.
- Player ascensions are kept.
- Forsaken permadeaths are kept.
- Famous deaths from Year 1 are immortalized as the **Foundational Lore** of Year 2 — visible to every new player as ancient legend.
- Faction balance and territory control carry over.
- New players entering Year 2 find a world already shaped.

A separate `STORY_BIBLE_Y2.md` will be authored after Year 1 lands. The shape of Year 2 depends on Year 1's outcome — too many branches to pre-author all of them.

## Authoring conventions

- **Faction voice**: each faction has a vocabulary the narrator system prompt references. Choristers speak in measured cadence; Rust Hand in clipped half-sentences; Idle in patient quiet; Forsaken in salt-and-silence images.
- **Recurring NPC voice cards**: live in `content/npcs/<id>.json` with `personality_card` field (already planned in Phase 2 Day 7-8 for companions; reuse the schema).
- **Chapter beats**: live in `content/story/chapters/<n>.json` with `{ chapterId, weekStart, weekEnd, theme, worldEvent, branchDecision?, narratorPromptFragment }`. The narrator system prompt loads the active chapter's fragment for tonal alignment.
- **No metaphysical surprises in the bible**. If something in Year 1 hinges on a hidden mechanic, it's documented here. The bible is the source of truth for content authors.
- **Player surprise comes from emergence**, not from authorial twists. The branches are public — players know they're voting; the *texture* of the year is what surprises.

## What this is NOT

- Not a script the narrator follows verbatim. It's a tonal + structural backbone.
- Not a constraint on the LLM narrator's freedom to write good prose. The narrator gets the chapter's *theme* and *world event* but generates its own scene-level prose.
- Not finalized. Branches and outcomes can be tuned during the year if data shows a path is too dominant or too dead.
