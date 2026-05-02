# Reincarnated in Another World as... — Revised Brief

> Original product/design brief, preserved verbatim. The 14-day execution plan is in [PLAN.md](PLAN.md). Locked decisions are in [DECISIONS.md](DECISIONS.md). This file is for capturing the *why* — when in doubt about a design choice, re-read this.

## Pitch

A persistent text RPG where every reincarnation (slime, cursed book, dragon egg, dungeon core, healer, ...) plays as a fundamentally different game. The world remembers what you did.

## Core principles

1. **Backend owns truth; the narrator writes prose.** The model never mutates state. It calls validated tools.
2. **Event-sourced.** Every action, roll, and state change is an immutable event. Current state is a projection of the log. Replay, branch, debug, eval — all fall out for free.
3. **Form-aware mechanics.** A book and a slime don't share a stat block.
4. **Tiered inference.** Cheap models classify and extract; one expensive call per turn does narration.
5. **Model-agnostic.** Swap providers — or remove the model entirely — without touching game logic.

## True MVP (target: 2 weeks solo)

Strip to skeleton:
- **One** reincarnation form: Lesser Slime
- **One** starting location: Collapsed Dungeon Tunnel
- **One** quest: survive the night, 3–5 hand-authored beats
- No auth — anon session in a signed cookie, claim-account later
- One model behind one interface
- 10-turn session cap for the prototype

Acceptance: anon player hits URL, plays 10 turns, lives or dies, sees a recap. That's it.

Build the second form (Cursed Book) **only** after the first is genuinely fun in a tight world. If it isn't fun constrained, more content won't save it.

## Resolution: 2d6 PbtA, not d20

- **10+** : success
- **7–9** : success with cost / partial
- **6–** : miss, narrator makes a hard move

Three narrative branches per check instead of two. The middle branch is where the best fiction lives, and it removes flat "you fail, nothing happens" outcomes. Modifiers from form-stats, small range (-2 to +3).

## Form-aware character model

Drop the universal stat block. Each form is a template:

```yaml
Slime:
  vitals: { cohesion, essence }
  stats: { density, viscosity, awareness, will }
  verbs: [absorb, split, ooze, sense_tremor, dissolve]
  evolution: [greater_slime, acid_slime, metal_slime]

Cursed Book:
  vitals: { pages_intact, ink_reserve }
  stats: { lore, persuasion_via_text, fragility, malice }
  verbs: [whisper, flip_pages, be_read, curse_reader, summon_marginalia]
  evolution: [grimoire, living_library, sealed_codex]
```

Shared `Vitals` and `StatModifier` interfaces keep the rules engine generic; forms supply their own vocabulary. Form-specific verbs are also the narration vocabulary the model is constrained to.

## Architecture: per-turn flow

```
1. Player submits action
2. Backend loads projection at HEAD
3. Classifier model: { needs_roll, roll_type, stat, dc, entities_referenced }
4. Backend executes roll (server RNG, seeded for replay)
5. Backend retrieves: canonical entities by ID + top-k episodic memories
6. Narrator model receives: state + roll + memories → narration + tool calls
7. Backend validates each tool call against rules engine
8. Tool calls become events appended to log
9. Projection updates; response returns to client
```

## Tools (model-callable, server-validated)

```
apply_damage(target_id, amount, source)
heal(target_id, amount)
add_inventory(item_template_id, quantity)
remove_inventory(item_id, reason)
move_to(location_id)
discover_location(location_template_id)
introduce_npc(template_id, attitude)
update_relationship(npc_id, delta)
update_quest_objective(quest_id, objective_id, status)
grant_xp(amount)
create_memory(importance, summary, entity_ids[])
```

If the model wants to do something there is no tool for — it narrates the attempt only. This single constraint kills 90% of state hallucination.

## Memory: two tiers

- **Canonical** (Postgres): NPCs, locations, factions, items. AI references by ID. New entities introduced mid-narration are persisted in the same transaction.
- **Episodic** (pgvector): event summaries with embeddings. Per-turn retrieval = embedding similarity × entity overlap × recency decay.

**Entity discipline.** `introduce_npc` takes a template ID from a curated bestiary. The model does not invent "Goblin Knight Elara" out of thin air at turn 50. New templates are authored offline (or generated offline and reviewed). This is the single most important defense against canon drift.

## Stack

- **Next.js 15** (app router) — frontend + API routes, one deploy
- **Drizzle + Postgres + pgvector**
- **Inngest** or a single worker for async (embeddings, summaries) — skip Redis/BullMQ until needed
- **One** AI provider behind a `Narrator` interface
- **Vercel** or **[Fly.io](http://Fly.io)**

NestJS, Redis, BullMQ, separate backend service: post-MVP only.

## Narrator interface (provider-agnostic)

```ts
interface Narrator {
  narrate(input: {
    state: Projection;
    action: string;
    roll?: RollResult;
    memories: Memory[];
  }): Promise<{ prose: string; tool_calls: ToolCall[] }>;
}
```

Three implementations from day one:
1. `RemoteNarrator` — Anthropic / OpenAI / etc.
2. `LocalNarrator` — Ollama, qwen2.5-coder:14b or similar
3. `TemplateNarrator` — phrase-bank grammar, no model. Lower variety, deterministic, free, used for tests and offline mode.

## Cost tiering

| Step | Model |
|---|---|
| Action classification | Haiku / 4o-mini / local 7B |
| Entity extraction | same |
| Memory ranking | embedding model only |
| Narration | Sonnet / GPT-4-class, **once per turn** |
| Session summary | Sonnet, once per session end |

Per-turn cost target: under $0.01 at scale.

## Eval harness (day one, not later)

Golden set of ~20 scenarios. Each = state snapshot + player action + rubric:

- Respected HP / inventory? (binary)
- Stayed in second person? (binary)
- Used correct tool? (binary)
- Invented un-authorized entities? (binary)
- Tone match (1–5, judge model or human)

Run on every prompt change. Without this you are flying blind.

## Milestones

**M1 — Skeleton (week 1)**
Schema + event log + projection + slime template + 2d6 engine + 5 hand-authored beats + `TemplateNarrator`. Playable with no AI.

**M2 — Narrator (week 2)**
`RemoteNarrator`, tool calling, episodic memory, eval harness. Slime story feels alive.

**M3 — Persistence**
Auth, save/resume, session summaries, world-state timeline shown to player.

**M4 — Second form (Cursed Book)**
Validates that the form-template architecture actually generalizes. Painful but essential before scaling content.

**M5 — Polish & deploy**
Status panel, quest log, inventory cards, dice animations, public deploy.

## Deferred (not MVP)

Multiplayer · image gen · voice · marketplace · monetization · more than two forms · combat beyond skill-checks · procedural world generation · multi-provider abstraction beyond one interface

## Risks

- **Canon drift.** Mitigated by entity-ID discipline + canonical DB + retrieval.
- **Tone collapse.** Mitigated by form-specific verb sets and form-specific opening prompts.
- **Death loops.** Mitigated by 2d6 partial-success branch and low-DC opening encounters.
- **Cost spikes.** Mitigated by tiered models, turn caps, cached opening scenes.
- **Scope creep.** Mitigated by the MVP carve-out above. Resist additions until the slime is fun.

## Build philosophy

The model writes the story. The backend owns the truth. The world remembers.

Everything else is detail.
