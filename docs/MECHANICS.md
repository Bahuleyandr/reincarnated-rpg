# Mechanics

## Resolution: 2d6 PbtA

Roll 2d6 + stat-mod (+ optional situational mod). Bands:

| Total | Band | Outcome |
|---|---|---|
| 10+ | success | Player succeeds; narrator describes |
| 7–9 | partial | Success with cost; narrator MUST pick from form's hard-move menu |
| 6– | miss | Failure; narrator makes a hard move; tool calls reflect cost |

Modifier range: -2 to +3 from form stats. Situational modifiers cap at ±2 and must be justified by event log state.

Server rolls only. Seeded PRNG (mulberry32) for replay determinism. Seed stored in `roll.resolved` event.

## Form stat ranges

Each form template defines its own vitals + stats. Universal cap: stats range -2 to +3, vitals 0..max(form-defined). No universal stat block.

## Lesser Slime form sheet (M1)

```yaml
id: lesser-slime
vitals:
  cohesion:  { max: 8, start: 8 }   # death at 0
  essence:   { max: 5, start: 5 }   # mana-equivalent; powers absorb/sense
stats:
  density:    +1   # resist physical damage
  viscosity:  -1   # speed; locomotion check mod
  awareness:  +0   # sense check mod
  will:       +0   # resist domination/charm
verbs:
  - absorb       # signature: remove an item from world, gain trait/stat
  - split        # divide into two slimes (cooldown)
  - ooze         # locomotion (move_to)
  - sense_tremor # perceive vibration without sight
  - dissolve     # apply_damage to inanimate matter
  - smother      # apply_damage to oxygen-breathing target
  - mimic_shape  # change_form_state for stealth or fit
hard_moves:
  - lose_mass             # change_form_state cohesion -1
  - expose_core           # next damage roll auto-succeeds against player
  - alert_predator        # introduce_npc hostile
  - drip_into_wrong_crevice # move_to undesired room
  - absorb_something_toxic  # absorb but apply_damage
  - dry_out               # change_form_state viscosity -1
  - confuse_own_boundary  # next sense check at -2
  - merge_briefly_with_debris # pass_time +1 tick, no other action
evolution:
  - { trigger: cohesion>=12, toFormId: greater-slime }
  - { trigger: absorbed:acid x3, toFormId: acid-slime }
  - { trigger: absorbed:metal x3, toFormId: metal-slime }
```

(Authoritative copy lives at `content/forms/lesser-slime.json`.)

## Negative vocabulary (slime form)

The narrator must never use these words about the player:

- Body: `hand`, `hands`, `arm`, `arms`, `leg`, `legs`, `foot`, `feet`, `head`, `face`, `mouth`, `eyes`, `nose`, `ear`, `ears`, `tongue`, `teeth`, `skin`, `bone`
- Action: `grab`, `grip`, `clutch`, `hold`, `walk`, `run`, `leap`, `jump`, `stand`, `sit`, `kneel`, `crouch`, `step`
- Sense (visual): `see`, `look`, `watch`, `gaze`, `glance`, `glimpse`, `stare`
- Sense (verbal): `speak`, `say`, `voice`, `shout`, `whisper`, `talk`, `call`
- Misc: `point`, `nod`, `shake-head`

NPCs and the surrounding world may still use these words; the prohibition applies to second-person narration about the player only.

## Sample corpus (slime form)

Five hand-authored second-person slime-POV passages of 200–400 words each are embedded in the system prompt as one-shot exemplars. Authoritative copy at `content/forms/lesser-slime.json` under `sampleCorpus`.

## Other forms (post-MVP)

| Form | Vitals | Verbs (signature) | Hard-moves (signature) |
|---|---|---|---|
| Cursed Book | pages_intact, ink_reserve | whisper, flip_pages, be_read, curse_reader, summon_marginalia | a page tears, ink runs, reader resists, an unwanted reader picks you up |
| Dungeon Core | mana, integrity | scry, shape_terrain, summon_minion, awaken_trap | mana spike, vein collapse, intruder bypass, minion turns |
| Dragon Egg | warmth, attunement | hum, attune, bond, awaken_partial | grow cold, attract scavenger, bond rejected, premature crack |
| Healer | stamina, faith | mend, soothe, channel, exorcise, comfort | over-channel drain, recipient resists, faith wavers, attract attention |

These do not ship in v0.1.
