# Asset commission brief

A reference for outsourcing the visual + audio assets discussed in
the "more than text?" thread (and the WarOfDragons inspiration
audit). The code-side groundwork (per-form CSS theming, TTS opt-in,
form-specific motion) shipped under P7. What remains needs an
illustrator and a composer / sound librarian.

---

## Brand frame (read first)

Reincarnated is a **second-person, literary, restrained** text RPG.
Every form plays differently because the prose is form-aware. The
brand promise is **"the world remembers what you did."** Visuals
must support that — not advertise a different game.

What we **don't** want:

- Hero-shot dragons or dramatic poses.
- Speech-bubble UI or NPC portraits with smiles.
- Saturation. The whole site is stone-grey, amber, and emerald;
  art needs to live in that palette.
- Anything that suggests "browser MMO" (no faux-3D bevels, no
  health bars overlaid on portraits, no stylized capes).

What we **do** want:

- Quietness. Empty space. Single subjects.
- Detail in texture, restraint in composition.
- Worn / used / lived-in objects. The dungeon-core is a worn
  crystal, not a glowing gem.
- Ink + pencil + ash. Not oil, not airbrush, not anime.
- Reference points: Hand of the Cartographer (Dwarf Fortress
  parchment maps), Disco Elysium's portrait restraint, *Outer
  Wilds*'s muted sky-tones, the woodcut feel of ARS Magica
  rulebooks, monastic illumination minus the gilt.

---

## Wave 1 — reincarnation cards (highest priority)

Six pieces, sized for `/reincarnate`'s rotation cards. Each card
already carries:

- a `displayName` ("A dwarven brewer between casks")
- a one-sentence flavor ("One has just gone out. The next won't
  be ready for nine days.")
- a `COMMON` / `UNCOMMON` rarity tag

What we want from the artist: **one square illustration per card**,
~600×600 source, deliverable as PNG at 1×, 1.5×, 2× DPR. Subject
is the form, not the player. The cards rotate every 24h so we'll
need ~16 over the year — start with these six:

| Form id | Subject |
|---|---|
| `lesser-slime` | A pool of dim green substance pooled in a cracked stone hollow. No face. No eyes. Just chemistry catching the light. |
| `dungeon-core` | A fist-sized crystal embedded in low chamber stone, lit only by its own slow blue pulse. The chamber is empty around it. |
| `cursed-book` | An open book on a lectern in a cold room, one page lit by a single candle. The page contains script we don't quite read. |
| `dragon-egg` | A leather-grey egg curled in straw on a high cliff nest, dusted with cliff-frost. A dam's wing-edge frames the top of the image. |
| `forsaken-revenant` | A figure in a long coat at the edge of a moonlit road, watching something we can't see. Their back is turned. |
| `the-still-one` | A seated figure on weathered stone in a small clearing, moss starting at their western edge. A visitor stands at the threshold of the frame. |

Constraints:
- No faces visible (or barely visible). The player imagines theirs.
- No human silhouette in the slime / book / egg / core cards.
- Same painter, all six. Series consistency is the win.

**Budget guess:** $300–600 / piece from a mid-career illustrator.
Six cards = $1,800–3,600 total. Could go $200/piece for a
student-level illustrator if the brief is tight.

---

## Wave 2 — recurring NPC portraits (lower priority)

17 NPCs in `content/npcs/*.json` with `metadata.recurring: true`.
We just shipped first-meet letters from each of them (P5). A small
headshot portrait per NPC would bring those letters to life and
seed the /registers "the recurring" register with faces.

Brief:
- Square 256×256 source, deliverable at 1× and 2× DPR.
- Bust crop. No backgrounds (transparent PNG).
- Same series-consistent ink-pencil style as Wave 1.
- Each NPC's `tagline` is the entire art direction. Examples:
  - **Captain Mira:** "barefoot, salt-cured, smaller than you
    expect, dangerous in a way the size makes worse."
  - **Rhozell:** "tall, narrow, dressed in ash-grey scale that
    fits like skin."
  - **Aune the Signer:** "all hands, no voice."
  - **Vohn the Returned:** "broad-shouldered, vestigial-tusked,
    ink-stained."

Where to use them in the UI:
- The /letters inbox row (next to NPC sender name)
- The /registers "the recurring" cards
- The /world map (small clickable nodes — future)

**Budget guess:** $80–150 / portrait. 17 portraits = $1,400–2,550.

---

## Wave 3 — five city / region key art

We have six locations the player can travel to. Each carries a
JSON with rooms + ambient prose. A header image per location
would anchor the /world page and the per-location detail pages.

| Location | Key visual |
|---|---|
| `the-coral-anchorage` | Pontoons over reef. Six ships, four ribbons. |
| `caelum-by-the-wash` | The estuary metropolis, distant, from a river. |
| `threadwarden` | Stooped indigo-dyer at a window in a tall narrow building. |
| `saltgale` | Off-elven customs house at the river's mouth. |
| `highfield-ascending` | Wind-burned high meadow with bone instruments at a perch. |
| `the-long-indices` | Cliff library carved into limestone. |

Brief:
- Wide aspect (2:1 or 16:9), source ~1920×960.
- Day / dusk / night variants per location would be lovely later
  but **start with one per location** at the location's defining
  hour.
- No people. The world.

**Budget guess:** $400–800 / piece. Six locations = $2,400–4,800.

---

## Wave 4 — per-form ambient audio loops

Optional but high-leverage. Each form gets a 30-90 second loop
that plays softly under the play-page when the matching form is
active. The TTS toggle (P7.B) doesn't preclude this — they
coexist.

| Form | Texture |
|---|---|
| `lesser-slime` | Wet stone, slow drip, faint chemical hiss. Cave-quiet. |
| `dungeon-core` | A low constant hum at ~60Hz, plus very distant footsteps. |
| `cursed-book` | Page-turn, ink-pen scratching, candle-room hush. |
| `dragon-egg` | Wind off a cliff face, distant heartbeat (the dam). |
| `forsaken-revenant` | Wind across an empty field at 3am. No voices. |
| `the-still-one` | Single tone (a sustained C2?) under faint cricket-song. |
| Others | Variations on the appropriate trade. Salt-keeper = barrel-creak; Furnace-warden = banked fire breathing. |

Constraints:
- Loop seamlessly. Player will hear it for 5+ minutes.
- Volume defaults to 30%, with an opt-in toggle (similar to
  NarrationVoice). LocalStorage persistence.
- All in the public domain or commissioned-with-rights — we ship
  CC BY-NC.

**Budget guess:** $50–150 / loop from Freesound / commission. 15
forms × the simpler texture work = $750–2,250 total. A composer
willing to do all 15 in a single sitting: probably $1,200–2,500
flat.

---

## Where these would land in the codebase

- `public/forms/<id>.png` — Wave 1 reincarnation cards. Already
  no-op imported by `/reincarnate` — adding them is a one-line
  per-card change.
- `public/npcs/<slug>.png` — Wave 2 portraits. The
  `getFirstMeetLetterForNpc` helper can return a portraitUrl
  pointing here; `/letters` and `/registers` read it.
- `public/locations/<id>.jpg` — Wave 3. `/world/[id]` already
  has a `headerImageUrl` field in the location render that's
  null today; populate from this path.
- `public/audio/forms/<id>.opus` — Wave 4. New
  `<NarrationAmbient>` component (mirror of NarrationVoice) with
  HTML5 `<audio loop>` + a localStorage opt-in toggle.

---

## Total

If we did all four waves at the mid of each estimate: ~$8,000–
$12,000 art + audio commission. If we did just Wave 1
(reincarnation cards), the highest-leverage piece: ~$2,500.

The minimum viable visual upgrade is Wave 1 alone. Adding it
(without Waves 2–4) would already lift /reincarnate from "the
strongest UX surface" to "the surface that sells the game in a
single screenshot."
