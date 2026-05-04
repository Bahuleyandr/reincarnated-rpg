# Post-MVP Build Plan

**Status as of 2026-05-03**: M1 (template narrator) + M2 (remote narrator + memory + 20 evals) shipped. v0.1.0 tagged. Energy tiers + Blessing of the Gods + daily streak + moderation/curses/power-caps all merged on `master`. Read `PLAN.md` for the original 14-day MVP plan; this doc covers what comes after.

The wedge — *"a text RPG where every life is a different game, and the world remembers"* — is now playable end-to-end. The next 14 days extend the wedge along three axes:

1. **Persistence depth**: the world remembers more (legacy traits, companions), and the player accrues meaningful cross-run state (achievements, titles, objectives).
2. **Social fabric**: players see and affect each other — gifting, shared replays, world-boss raids on the Long Wyrm.
3. **Content multipliers**: dialogue gets its own pipeline; players can submit forms; scenes get optional images.

## Locked decisions

- **No new frameworks.** Everything below extends the existing Drizzle + Next 16 + Anthropic SDK stack. No event-sourcing libraries, no graph DB, no queue.
- **Predicate engine is shared infrastructure.** Achievements, daily objectives, and legacy-trait imprinting all reduce to "evaluate a predicate over a slice of the event log." Build the engine once on Day 1; reuse for three features.
- **User-level state, not session-level.** Legacy traits, achievements, bonded companions, pinned title, mood preset — all live on `users.*` (or a satellite table keyed on `userId`). They survive reincarnation. Anon sessions opt out gracefully (everything is null and we don't crash).
- **Append-only stays sacred.** No new mutable tables for game-state — everything is either a fresh event in the log, a snapshot derivative, or user-level metadata.
- **Test discipline.** Each feature lands with both unit (predicates / pure logic) and integration (DB round-trip) coverage. Integration tests pre-seed the relevant `users.*` fields so they don't depend on default semantics that could shift.
- **Schema migrations are sequential.** Numbered 0020 onward. One per feature unless features share a table.

## Day plan

| Day | Feature | Output |
|---|---|---|
| 1 | predicate engine | `lib/predicates/` — pure rule DSL over event-log slices |
| 2 | predicate engine | predicate runner + telemetry; first user (legacy traits) integrated |
| 3 | legacy traits | death-cause classifier + imprint store + character-page surfacing |
| 4 | achievements | catalog + unlock pipeline + character-page list |
| 5 | titles | pinning + leaderboard badge + `/character` chooser |
| 6 | daily/weekly objectives | catalog + reset cron + `/play` ribbon |
| 7 | companion NPCs | bond flag + recall hook + reappearance logic |
| 8 | companion NPCs | dialogue continuity across runs + character-page roster |
| 9 | gifting | `gifts` table + send/receive UI + daily cap |
| 10 | run replay / share | share token + public renderer + OG image |
| 11 | mood presets | settings toggle + prompt fragment |
| 12 | adaptive difficulty | death-streak detector + scaling |
| 13 | world boss raids | meta-arc HP + contribution rollup + raid status panel |
| 14 | scene images | provider integration + per-event caching + opt-in |
| **15** | **public world lore (24h delay)** | `/lore` page + delayed-read endpoint + world-pulse ticker |
| **16** | **foreshadowing memory plants** | `memory.echo_planted` event + delayed-surface retrieval |
| **17** | **wonder events** | `content/wonders/` catalog + per-turn 1% trigger |
| **18-19** | **economy: currency + NPC vendors** | `users.coins` + `trade_with_npc` tool + central-bank pricing |
| **20** | **resource items + craft credits** | resource catalog + 0.1-energy/action via 0-9 credit counter |
| **21** | **gathering + location resources** | `gather_resource` tool + location resource tagging |
| **22** | **smelting + smithing + recipes** | `smelt`/`smith` tools + `content/recipes/` |
| **23-24** | **skills + XP + NPC trainers** | `user_skills` table + level curve + `learn_skill_from(npcId)` |
| **25** | **buy/sell loop end-to-end** | tutorial vendor in starter zone + eval scenario |
| **26** | **economic balance + telemetry** | sell-buy markup, anti-farm caps, resource respawn, coin-flow logs |
| **27** | **skills/recipes UI + achievements** | character page skills tab + recipe book + economy achievements |
| **28** | **famous deaths ticker** | memorability predicate + `world_lore` writeback + homepage ticker |
| **29** | **reincarnation cooldowns** | `recent_form_deaths` + picker filter + UI surfacing |
| **30** | **custom epitaphs** | recap-screen last-words → location-tied lore |
| **31** | **custom item naming** | `rename_inventory` tool + projection field + narrator integration |
| **32-33** | **player notes in locations** | `location_notes` table + `leave_note` tool + read/upvote/decay |
| **34-35** | **named antagonist (Rhozell, the Wyrm's hand)** | personality card + cross-run memory + appearance hook |
| **36-37** | **first-10-minutes tutorial** | scripted slime intro + graduation flow + new-user routing |
| **38** | **calendar engine** | `world_calendar` table + chapter advancement cron |
| **39** | **chapter prompt-fragment injection** | narrator system prompt picks up active chapter tone |
| **40-41** | **faction state** | `factions` table + `pledge_faction` tool + per-chapter contributions |
| **42** | **branch decision tracking** | branch resolution + persistent canon |
| **43-44** | **recurring NPC engine** | chapter-gated NPC rotation + cross-run history weighting |
| **45-46** | **Wyrm raid → Branch V wiring** | aggregate damage drives mid-year arc compression |
| **47** | **Three Votes machinery** | Books XI-XII vote tallies + resolution |
| **48** | **endings machinery** | year-end ending resolver + Year 2 seed |
| **49** | **First-to-Sit + Edicts** | Hollow Throne quest + player-note → law promotion |
| **50** | **scheduled world events** | Wyrm Voice + other synchronized injections |
| **51** | **story authoring tooling** | CLI scaffolder + validator + eval scenario 22 |
| **52** | **story admin dashboard** | `/god/story` for live ops |
| **53** | **Catch-Up Codex** | per-chapter summary + mid-year onboarding flow |
| **54** | **Year Archive** | end-of-year snapshot + `/world/year/[n]` pages + Year 2 seed |

Days 55+ are the **bigger swings** that don't fit a single-day box: NPC dialogue system (3-5 days), player-authored forms (5-7 days), ascension (7-10 days), player-driven marketplace (7+ days). Treat them as independent milestones after Day 54 lands.

Story bible source-of-truth: `docs/STORY_BIBLE.md`. Read it before authoring chapter content or wiring story machinery.

**World clock locked at 1:1 real time** (ADR-019). 1 chapter = 7 real days, UTC. 1 Year = 365 real days. Admin pause is the only way to halt the clock. Test/preview environments use `STORY_TIME_FACTOR` env var to accelerate; production hard-codes 1.0.

---

## Phase 1 — Predicate engine + thematic core

### Day 1-2: Predicate engine (shared infra)

**Why first**: Three later features (achievements, daily objectives, legacy traits) all want to ask the same question — "given this event log slice, did *X* happen?". Build the engine once.

**New files**
- `src/lib/predicates/types.ts` — `Predicate = (events: Event[], ctx?: PredCtx) => boolean`. `PredCtx` carries `{ userId, sessionId, projection, now }`.
- `src/lib/predicates/dsl.ts` — composable builders: `all([...])`, `any([...])`, `not(p)`, `count(filter, ">= 3")`, `eventOfKind('damage.applied')`, `havingTool('absorb')`, `inOrder([...])`, `withinTurns(p, 5)`.
- `src/lib/predicates/runner.ts` — `evaluate(predicate, events, ctx)` returning `{ matched: boolean, evidence: Event[] }`. Evidence is the subset of events that contributed (for audit / UI).
- `tests/unit/predicates.test.ts` — every combinator round-tripped against synthetic event arrays.

**Schema**: none. Predicates are pure functions; their output is consumed by the features that use them.

**Acceptance**: 30+ unit tests pass. All combinators have at least one positive + one negative case. Evidence collection works for `all`, `any`, `inOrder`.

**Gotchas**
- Don't make predicates async. Every predicate should be a sync function over an in-memory event slice. The slice is fetched once per feature pass; predicates don't re-query the DB.
- Don't conflate predicates with reducers. Predicates *recognize* shapes; reducers *fold* state. We already have reducers (projection.ts).

### Day 3: Legacy traits

**Why now**: Strongest thematic fit ("the world remembers" extended to YOU). Compounds with everything downstream — achievements can check trait history, companion NPCs comment on traits, NPC dialogue references them.

**Schema migration `0020_legacy_traits.sql`**
```sql
ALTER TABLE users ADD COLUMN legacy_traits jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Shape: { fire_scarred: 2, water_affinity: 1, whimsical: 1 }
-- Trait keys are stable slugs from content/legacy/traits.json.
-- Values are accumulated counts (each death imprints +1).
```

**New files**
- `content/legacy/traits.json` — the catalog. ~20 entries: `fire_scarred`, `water_affinity`, `unburnt`, `crushed`, `gravity_aware`, `whimsical`, `etc`. Each entry: `{ id, label, description, mechanicalEffect: string }`.
- `src/lib/legacy/imprint.ts` — pure: `imprintTraitFromDeath({reason, formId, projection}) → traitId | null`.
- `src/lib/legacy/apply.ts` — pure: `applyLegacyTraitsToStarterFormState(traits, formId) → Record<string, number>`. Maps owned traits to form-state buffs at session creation. E.g. `fire_scarred` → `{ fire_resistance: +1 }` for any heat-vulnerable form.
- `tests/unit/legacy-imprint.test.ts` — death cause + form → trait, all branches.
- `tests/integration/legacy.test.ts` — full roundtrip: kill a slime by drowning → user.legacy_traits gains `water_affinity:+1` → next session for same user has `form.state.water_affinity=1`.

**Hooks**
- `src/lib/memory/world.ts` `persistRunToWorld` calls `imprintTraitFromDeath` and updates `users.legacy_traits` jsonb (atomic `jsonb_set` with default).
- `src/lib/game/session.ts` `createSession` for logged-in users: read `users.legacy_traits`, run `applyLegacyTraitsToStarterFormState`, merge into `starterFormState`.
- `src/app/api/character/route.ts` returns `legacyTraits: { id, label, description, count }[]`.
- `src/app/character/page.tsx` adds a "scars and gifts" section listing traits.

**Acceptance**: Logged-in player dies in fire as a slime → reincarnates as a different form → character page shows "🜂 Fire-scarred (1)" → next form's projection has `fire_resistance: 1`. Anon sessions ignored cleanly. Trait count is monotonic — multiple deaths from the same cause stack.

**Gotchas**
- Death cause is encoded in `session.ended.reason` only as `"death" | "won" | "cap"` — too coarse. Need to enrich: walk back through events to find the last `damage.applied` and use its `source` / `vital` for trait selection. Fall back to the form's primary vulnerability if no damage event found.
- Don't apply traits retroactively to existing campaigns — only to NEW sessions created post-imprint.

### Day 4: Achievements (catalog + unlock pipeline)

**Schema migration `0021_achievements.sql`**
```sql
CREATE TABLE achievements_unlocked (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id text NOT NULL,    -- stable slug from content/achievements.json
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  campaign_id uuid REFERENCES campaigns(id),
  evidence_event_ids bigint[],      -- for audit / replay
  UNIQUE (user_id, achievement_id)
);
CREATE INDEX achievements_user_idx ON achievements_unlocked (user_id);
```

**New files**
- `content/achievements.json` — ~40 hand-curated entries. Each: `{ id, label, description, predicate: <DSL JSON>, hidden: bool, titleAwarded: string | null }`.
- `src/lib/achievements/catalog.ts` — loads + parses JSON into typed predicates.
- `src/lib/achievements/runner.ts` — `evaluateAchievements(userId, events, ctx)`: walks the catalog, runs each unlocked-already-filter, then evaluates predicates against fresh events. Inserts new unlocks atomically.
- `src/app/api/achievements/route.ts` — `GET` returns the user's unlocks + the full catalog (description + label, NOT the predicate JSON).
- `tests/unit/achievements.test.ts` — predicate parsing round-trip; cataloged achievements all parse.
- `tests/integration/achievements.test.ts` — first death unlocks "Mortal Reminder"; helping an NPC after harming them unlocks "Reformed".

**Hooks**
- After `persistRunToWorld` (run end), invoke `evaluateAchievements`. Also run on every `session.ended.reason='cap'` and every `npc.relationship.updated` (so non-death progress lands too).
- Surface unlocks in the API response of `/api/turn` and `/api/turn/stream` as `newAchievements: string[]` so the UI can flash them.

**Acceptance**: 40 achievements catalogued with predicates that all parse. Integration test verifies 5+ trigger correctly. Unlock event fires once per achievement per user (UNIQUE constraint).

**Gotchas**
- Don't evaluate every achievement on every turn — bound the runner to predicates that name an event-kind that appeared in this turn. Keep an `achievement.relevantKinds: EventKind[]` field per entry for cheap filtering.
- Predicates that span multiple campaigns (e.g. "play 5 different forms") need a different evaluation path — they read from `worldMemories` / `campaigns` not the per-session event log. Mark those with `scope: 'lifetime'` and run them on a separate trigger (run-end only).

### Day 5: Titles (display + pinning)

**Schema migration `0022_titles.sql`**
```sql
ALTER TABLE users ADD COLUMN pinned_title text;
-- Validated against achievements_unlocked.title_awarded when present;
-- player can also un-pin (NULL).
```

**Files modified**
- `content/achievements.json` — fill in `titleAwarded` on ~15 of the 40 entries.
- `src/app/api/character/route.ts` — return `availableTitles: { id, label }[]` (derived from unlocks where `titleAwarded` is set) + `pinnedTitle: string | null`.
- `src/app/character/page.tsx` — title chooser dropdown.
- `src/app/api/leaderboard/route.ts` — include `pinnedTitle` in the row payload.
- `src/components/Leaderboard.tsx` — render the title under the username.

**Acceptance**: Player unlocks "Reformed" → a title "the reformed" becomes pinnable → leaderboard row shows "username — the reformed". Validation: setting `pinnedTitle` to a string the user hasn't earned returns 403.

### Day 6: Daily / weekly objectives

**Schema migration `0023_objectives.sql`**
```sql
CREATE TABLE objective_progress (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  objective_id text NOT NULL,
  period_key text NOT NULL,          -- '2026-05-03' for daily; '2026-W18' for weekly
  progress integer NOT NULL DEFAULT 0,
  target integer NOT NULL,
  completed_at timestamptz,
  reward_claimed_at timestamptz,
  UNIQUE (user_id, objective_id, period_key)
);
CREATE INDEX obj_user_period_idx ON objective_progress (user_id, period_key);
```

**New files**
- `content/objectives.json` — `{ id, label, description, period: 'daily'|'weekly', target: number, predicate: <DSL>, reward: { kind: 'energy', amount: number } }`. ~10 daily + 5 weekly to start.
- `src/lib/objectives/runner.ts` — increments `progress` based on predicate hits per turn; flips `completed_at` when reaching target. Period rollover handled in `currentPeriodKey(period, now)` (UTC-day for daily, ISO-week for weekly).
- `src/app/api/objectives/route.ts` — GET (list w/ progress) + POST `/claim` (apply reward, set `reward_claimed_at`).
- `src/components/ObjectiveRibbon.tsx` — small ribbon above the play view showing the active daily.

**Hooks**: same trigger points as achievements (post-turn, post-run-end). Reward claim is explicit (player taps "claim" in the UI; energy granted via `adminSetEnergy`-like helper).

**Acceptance**: Brand-new daily resets at 00:00 UTC; player completes "take 3 turns as a non-slime form" → `progress=3 target=3 completed_at=...` → claim flips `reward_claimed_at` and grants +5 energy. Idempotent claim.

**Gotchas**
- Period rollover: tests should use injected `now: Date` (don't call `Date.now()` in pure code).
- Free-tier players' grants can put them above the tier max (one-shot gifts, like the streak grant). The energy code already supports this.

---

## Phase 2 — Social + persistence

### Day 7-8: Companion NPCs

**Schema migration `0024_companion_npcs.sql`**
```sql
ALTER TABLE world_npcs ADD COLUMN bonded_with_user_id uuid REFERENCES users(id);
ALTER TABLE world_npcs ADD COLUMN bonded_at timestamptz;
ALTER TABLE world_npcs ADD COLUMN personality_card jsonb;
-- bonded_with_user_id NULL = ordinary world NPC; non-null = companion of that user.
-- personality_card: { voice: string, mannerisms: string[], topics_of_interest: string[] }
CREATE INDEX npcs_bonded_user_idx ON world_npcs (bonded_with_user_id);
```

**New files**
- `src/lib/companions/bond.ts` — pure: when a `relationship.updated` event lifts an NPC's score to ≥ +3 in any of a user's runs, mark them `bonded_with_user_id`. Generate a personality card via Haiku 4.5 (one-time, cached on row). Pure check is the "should bond now" predicate; the LLM call is in `bond.materialize`.
- `src/lib/companions/recall.ts` — at turn 1 of a new campaign for a logged-in user, query their bonded companions and surface up to 2 in `relevantMemories` (ordered by recency of last interaction). The narrator gets to decide whether to include them in this turn's prose.
- `src/app/api/character/route.ts` — `companions: { name, formMet, personalityHint, lastSeenInRun: campaignId }[]`.
- `src/app/character/page.tsx` — "those who remember you" section.
- `tests/unit/companions-bond.test.ts` — relationship threshold check, idempotence.
- `tests/integration/companions.test.ts` — bond fires once; recall surfaces in next campaign's `relevantMemories`.

**Hooks**
- `applyTools` post-`update_relationship`: kick off `bond.shouldBond` predicate; if true, queue a `bond.materialize` (it's an LLM call, can be deferred — but for v1 do it inline).
- `runTurn` step 6 (memory retrieval) on turn 1: prepend up to 2 companion summaries.

**Acceptance**: Logged-in player befriends an NPC to +3 → that NPC's row gains `bonded_with_user_id`. Same player starts a new campaign → turn 1's relevantMemories includes a "you remember Kethra, the scholar you saved as a slime" line → narrator references her by name in the opening prose.

**Gotchas**
- Bond materialization shouldn't happen inside `applyTools` (it'd block the turn on an LLM call). Move it to a post-turn hook in the route, after writing the response.
- A bonded NPC may already be bonded to another user — they're personal companions, not shared. If they appear in someone else's run, that's a different relationship row.
- Tone-checker for personality card generation: the card is plain JSON, not narration; skip tone check.

### Day 9: Player gifting

**Schema migration `0025_gifts.sql`**
```sql
CREATE TABLE gifts (
  id uuid PRIMARY KEY,
  from_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,                -- 'blessing' | 'energy' | 'cleanse'
  payload jsonb NOT NULL,            -- { amount: 1 } for energy, etc.
  message text,                      -- 280-char optional note
  sent_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz,
  CHECK (from_user_id != to_user_id)
);
CREATE INDEX gifts_to_user_unredeemed_idx ON gifts (to_user_id) WHERE redeemed_at IS NULL;
```

**New files**
- `src/lib/gifts/send.ts` — pure rate-limit check (1 outgoing/day) + insert. Idempotency via `(from_user_id, to_user_id, sent_at::date)` uniqueness in code (not constraint — different kinds same day OK).
- `src/lib/gifts/redeem.ts` — atomic: mark redeemed, apply effect (energy bump, bad_luck cleanse, etc.).
- `src/app/api/gifts/route.ts` — POST send / GET inbox / POST `/[id]/redeem`.
- `src/components/GiftInbox.tsx` — small dropdown near the EnergyBar showing unredeemed gifts.
- `tests/unit/gifts.test.ts` — rate-limit logic.
- `tests/integration/gifts.test.ts` — send → inbox shows → redeem → energy increased once.

**Acceptance**: Player A sends Player B a +1 energy blessing with a "good luck" note → B's gift inbox shows 1 unread → B redeems → +1 energy applied (uncapped, like streak grant) and the gift row gets `redeemed_at`. Re-redeem is a no-op.

**Gotchas**
- Username collision: validate by username lookup (case-sensitive, current schema). Add a small "user not found" 404 path.
- Anti-griefing: 1 outgoing gift per from_user per UTC day. (Inbound is unlimited.)

### Day 10: Run replay / shareable transcript

**Schema migration `0026_share_tokens.sql`**
```sql
ALTER TABLE campaigns ADD COLUMN share_token text;
ALTER TABLE campaigns ADD COLUMN shared_at timestamptz;
CREATE UNIQUE INDEX campaigns_share_token_unique ON campaigns (share_token) WHERE share_token IS NOT NULL;
```

**New files**
- `src/app/api/campaigns/[id]/share/route.ts` — POST flips a campaign to public, generates a 16-char token. DELETE un-shares.
- `src/app/run/[token]/page.tsx` — read-only transcript renderer. Reads events for the campaign's session(s), groups by turn, renders narration + key tools as a story. Includes the form name, location, final outcome, dice rolls (optional toggle).
- `src/app/run/[token]/opengraph-image.tsx` — Next 16 OG image generator with run title + form + outcome.
- `src/components/ShareButton.tsx` — copy-link button on the recap screen.

**Acceptance**: Completed run → click "share" → URL like `/run/abc123def456` works for anyone (logged-out included). OG preview renders form + outcome. Un-sharing returns 404 to non-owners.

**Gotchas**
- Active campaigns can be shared too — render with a "🔴 in progress" banner. Live updates via polling (every 30s) — we already have presence/SSE infra; use it.
- Filter out events that leak private info (none today; future-proof: never render `inputSanitized` raw, only `narration.emitted`).

---

## Phase 3 — Quality of life

### Day 11: Mood presets

**Schema migration `0027_user_mood.sql`**
```sql
ALTER TABLE users ADD COLUMN mood_preset text NOT NULL DEFAULT 'standard';
ALTER TABLE sessions ADD COLUMN mood_preset text NOT NULL DEFAULT 'standard';
-- Allowed: 'cozy' | 'standard' | 'brutal'.
```

**New files**
- `src/lib/narrator/moods.ts` — 3 presets, each a short paragraph appended to the system prompt:
  - `cozy`: "lean toward warmth and small kindnesses; hard moves should sting but not maim; let mistakes be recoverable."
  - `standard`: (no addition — current behaviour)
  - `brutal`: "treat the world as indifferent. hard moves should bite. failures cost. spare no false comfort."
- `src/app/settings/page.tsx` — radio chooser.
- `src/lib/narrator/remote.ts` — read mood from session/user, append to system prompt.

**Acceptance**: Settings change persists; same input on the same seed produces measurably different narration across moods (verified via a small eval scenario).

### Day 12: Adaptive difficulty

**Schema migration**: none (read from existing campaign-end events).

**New files**
- `src/lib/difficulty/adaptive.ts` — pure: count consecutive deaths in last N campaigns for this user; returns `{ deathStreak: number, modifier: number }`. `modifier` becomes a small +N to all rolls when deathStreak ≥ 3 (capped at +1).
- Hook in `runTurn` step 4 (roll resolution): add modifier. Log it as part of `roll.resolved` event so it's auditable.

**Acceptance**: 3 consecutive deaths trigger +1 to subsequent roll modifiers. First win or `cap` resets the streak.

**Gotchas**
- Don't combine with `bad_luck` — the player who's both dying and cussing is a special case; let them feel it.
- The modifier shouldn't affect the meta-arc contribution math — only individual rolls.

---

## Phase 4 — Bigger swings

### Day 13: World boss raids (Long Wyrm gets HP)

**Schema migration `0028_arc_hp.sql`**
```sql
ALTER TABLE meta_arcs ADD COLUMN hp integer;
ALTER TABLE meta_arcs ADD COLUMN hp_max integer;
-- Set on existing rows from existing progress: hp_max := 1000, hp := round((1 - progress) * 1000).
-- Future: each contribution_delta translates 1:1 to hp delta on the active arc.
```

**Files modified**
- `src/lib/meta/long-wyrm.ts` — `getCurrentArc` returns `hp/hp_max`; `applyContribution(delta)` updates hp atomically (lower bound 0).
- `src/app/api/world/route.ts` (or new `/api/world/wyrm/route.ts`) — public endpoint exposing wyrm HP %.
- `src/components/WyrmStatus.tsx` — small animated bar shown on the home page.
- When `hp` hits 0: emit a global "wyrm.fallen" event, tally the top contributors, mint a one-time achievement, roll a fresh arc with full HP.

**Acceptance**: Multiple players' contributions reduce HP visibly in real time (via the existing presence channel). At 0 HP, the arc rolls over and a new one (different seed) takes over. Top contributors get the "Slayer" achievement + title.

### Day 14: Inline scene images (opt-in, cost-gated)

**Schema migration `0029_event_images.sql`**
```sql
CREATE TABLE event_images (
  event_id bigint PRIMARY KEY REFERENCES events(seq) ON DELETE CASCADE,
  image_url text NOT NULL,
  image_blob bytea,                  -- cached locally to avoid re-fetch
  model_used text NOT NULL,
  cost_usd numeric(10,6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN scene_images_enabled boolean NOT NULL DEFAULT false;
```

**New files**
- `src/lib/images/generate.ts` — calls the image provider (TBD: Replicate `flux-schnell` for cost; Anthropic image-out when GA). Cache aggressively; respect per-user cost cap.
- `src/lib/images/triggers.ts` — pure: which events warrant an image? Suggested: form awakening (turn 1), first NPC introduction, death, win. ~3-5 images per run.
- `src/components/SceneImage.tsx` — lazy-rendered in the transcript when an event has an associated `event_images` row.
- `src/app/settings/page.tsx` — toggle + monthly spend display.

**Acceptance**: Toggle on → first turn's narration is followed by a small thumbnail. Cost stays below $0.05 per run. Disabling clears no rows but stops generating new ones.

**Gotchas**
- Don't block the SSE stream on image generation. Fire-and-forget; the UI polls or the client re-renders when the image lands.
- Cap users at 100 images/month on the free tier; supporter/patron get more.
- Privacy: images may inadvertently surface inputSanitized fragments via prompt → use a separate prompt-builder that strips player input.

---

---

## Phase 4.5 — Engagement adds (Day 15-17)

Three small, high-leverage features that change the *felt* texture of the game. Each is one day. They slot in after the Day 14 scene-images push because each one composes with what came before (lore page reads from world_lore which the world-boss work populates; foreshadowing rides on the existing memory retrieval; wonders can fire mid-raid for theatre).

### Day 15: Public world-lore page (24h delay)

**Why**: Players want to *see* their influence on the world, but seeing it instantly leaks too much (turns the lore ledger into a debug log) and removes the satisfying delay between cause and visible effect. A 24h-delayed public read gives the "I caused that" thrill *the next day*, lands during a different play session, and gives moderation a buffer to redact garbage before it goes public.

**Schema migration `0030_world_lore_visibility.sql`**
```sql
ALTER TABLE world_lore ADD COLUMN public_at timestamptz GENERATED ALWAYS AS (created_at + interval '24 hours') STORED;
ALTER TABLE world_lore ADD COLUMN admin_redacted boolean NOT NULL DEFAULT false;
CREATE INDEX world_lore_public_idx ON world_lore (public_at DESC) WHERE NOT admin_redacted;
```

**New files**
- `src/app/api/lore/public/route.ts` — paginated read where `public_at < now() AND NOT admin_redacted`. Cursor-paginated by `public_at DESC`. Cache 5 min.
- `src/app/lore/page.tsx` — server component listing lore by category (`world_event`, `npc_legend`, `player_deed`, `famous_death`). Filter chips. Stays open to anon users — no auth required for public reading.
- `src/components/WorldPulseTicker.tsx` — header strip showing the count of new lore in the last 24h vs the prior 24h ("the world has stirred 47 times since yesterday").
- `src/app/god/lore/page.tsx` (extend existing) — admin redaction toggle on each row; useful for griefing cleanup before lore goes public.
- `tests/integration/lore-public.test.ts` — entries < 24h old hidden, ≥ 24h old visible, redacted hidden regardless.

**Acceptance**: A player creates a lore entry → it doesn't appear on `/lore` for the next 24h → after 24h it shows on the public page. Admin redaction hides it from public read while leaving the row intact for replay.

**Gotchas**
- The `public_at` GENERATED column is set once on insert. Don't try to "expedite" by editing it; the delay is the feature.
- Cache invalidation: `/lore` is cached for 5min; new entries that just crossed the 24h boundary appear within 5min of becoming public. Acceptable.
- Don't expose `admin_redacted` rows even to the entry's original author — the rule is "if it crossed the line, it's gone for everyone".

### Day 16: Foreshadowing memory plants

**Why**: The narrator already retrieves memories. Promote some memories to be intentionally early-planted: when something significant happens at turn N, the engine plants an *echo* memory tagged to surface 2-5 turns later. The player gets a vague flavor line ("you remember a stranger's eye") and three turns later the stranger appears. Pure narrative juice; no new content authoring needed.

**Schema migration `0031_memory_echoes.sql`**
```sql
ALTER TABLE memories ADD COLUMN surface_after_turn integer;
ALTER TABLE memories ADD COLUMN echo_hint text;
-- surface_after_turn NULL = ordinary memory, surfaces immediately by similarity.
-- non-null = echo; full memory hidden until projection.turn >= surface_after_turn.
-- Until then, retrieval surfaces only `echo_hint` (a 1-line redacted teaser).
```

**New files**
- `src/lib/memory/echoes.ts` — pure: `shouldPlantEcho(event, projection) → { surfaceAfterTurns, hint } | null`. Triggers on: NPC introduction (echoed as "a face you'll see again"), discovering a hidden location, partial-success rolls on key beats.
- `src/lib/memory/episodic.ts` (modify) — `retrieveMemories` returns echoes-as-hints when `current_turn < surface_after_turn`, full memory otherwise.
- Hook in `runTurn` post-tools: call `shouldPlantEcho` on each emitted event; if it returns non-null, write an echo memory.
- `tests/unit/echoes.test.ts` — predicate logic.
- `tests/integration/echoes.test.ts` — plant on turn 3, surface on turn 6, hint visible turns 4-5.

**Acceptance**: A new NPC is introduced on turn 3 → an echo memory is planted with `surface_after_turn=6` and hint "a face you'll see again" → on turns 4-5, retrieval surfaces only the hint (narrator weaves it in as foreshadowing); on turn 6+, the full memory is available.

**Gotchas**
- Don't plant echoes on every event — only narratively significant ones. Cap at 1 echo per turn so the prose doesn't drown in foreshadowing.
- The hint string should be evocative but redacted. Generation is deterministic (template per echo trigger kind), not LLM-driven, to avoid leaking context.

### Day 17: Wonder events

**Why**: Players want "wait, what was THAT?" moments. A 1% per-turn random injection of a flavor-only event ("a god whispers your name", "a scroll falls from nowhere") creates the texture of a living world that has its own agenda. Pure narrative; no mechanical balance to maintain.

**No schema changes** — wonders are a content + system-prompt injection, not state.

**New files**
- `content/wonders/` — ~30 entries to start. Each: `{ id, formFilters: string[]|null, locationFilters: string[]|null, narrationFlavor, optionalToolEffect }`. Examples:
  - `whisper_unknown` (any form, any location): "a name you don't know is whispered close to your perception."
  - `scroll_fallen` (forms with hands or telekinesis, any indoor location): adds a `mystery_scroll` item to inventory.
  - `the_eye_opens` (any form, deep-underground location): the narrator describes a single eye that wasn't there before.
- `src/lib/wonders/select.ts` — pure: given `(form, location, recentWonders)`, return a wonder or null. 1% trigger rate; cooldown of 10 turns to prevent same wonder from re-firing.
- `src/lib/wonders/inject.ts` — wraps the narrator system prompt with the wonder's `narrationFlavor` line + a directive ("acknowledge briefly, don't explain").
- Hook in `runTurn` step 6 (after memory retrieval, before narrator call): roll for wonder; if hit, inject + emit `wonder.fired` event.
- `tests/unit/wonders.test.ts` — selector cooldown, filter matching.
- `tests/integration/wonders.test.ts` — wonder fires; event log records it; cooldown holds for 10 turns.

**Acceptance**: Across 100 turns, ~1% fire rate observed (run with deterministic seed for tests). When a wonder hits, the narration acknowledges it but doesn't derail the scene. `wonder.fired` events are visible in the audit log.

**Gotchas**
- Wonders with `optionalToolEffect` (like the scroll-fallen) MUST go through `applyTools` like any other tool — no shortcut writes. The wonder's effect is a synthetic `add_inventory` call by the engine on the player's behalf.
- 10-turn cooldown is per-wonder-id, not global — multiple different wonders can fire close together. Tune if it feels noisy.
- Wonders DO NOT cost energy. They're unsolicited gifts/threats.

---

## Phase 5 — Economy + crafting (Day 18-27)

The wedge so far is *every life is a different game*. Phase 5 adds *every life can also leave you something durable* — coins, resources, skills that persist across reincarnations. The economy starts as a **central bank** (NPC vendors with fixed catalog prices) so we can balance it; Phase 6 (deferred) opens player-to-player markets.

**Locked design choices**

- **Coins are user-level.** Stored on `users.coins`. Cross-run, like legacy traits + streak. Anon sessions get a session-scoped purse (ephemeral, lost on conversion).
- **0.1-energy crafting via integer credits.** Energy stays integer (don't break the existing system). Each gather/craft action consumes 1 of 10 `craft_credits`; rolling over to 10 spends 1 energy and resets to 0. UI shows "5 free crafts before next energy spend." Same regen path as energy — fully covered by existing tests once we extend them.
- **Skills are per-user, not per-form.** A slime that learns smithing keeps it. Lore-justified: the soul remembers craft just like it remembers scars.
- **Resources are regular items** with `category: 'resource'`. No separate inventory pool — keeps tooling simple, resource items count against the existing inventory cap.
- **NPC trainers gate access.** Skills aren't auto-discovered. The player must *meet* a trainer NPC and call `learn_skill_from(npcId)` (costs coins). This means each skill has a "first time you find Master Halrik in Iron-Reach" moment.

### Day 18-19: Currency + NPC vendors (central bank)

**Schema migration `0032_economy_currency.sql`**
```sql
ALTER TABLE users ADD COLUMN coins integer NOT NULL DEFAULT 50;
ALTER TABLE sessions ADD COLUMN coins integer NOT NULL DEFAULT 0;
-- Anon sessions: ephemeral purse. On register/claim, anon coins → user coins.
```

**New event kinds** (`lib/game/types.ts`):
```ts
| { kind: "coins.gained"; amount: number; source: string }
| { kind: "coins.spent"; amount: number; sink: string }
| { kind: "trade.completed"; npcId: string; action: "buy"|"sell"; itemId: string; qty: number; coinsDelta: number }
```

**New files**
- `src/lib/economy/coins.ts` — pure helpers (read/spend/award) + atomic DB writes routed through events. Negative balance disallowed.
- `src/lib/economy/vendor.ts` — pure: validate a trade against an NPC's catalog. Catalog lives in `content/npcs/<id>.json` under `metadata.catalog: [{ itemId, buyPrice, sellPrice, stock?: number }]`.
- New tool in `lib/game/tools.ts`: `trade_with_npc(npcId, action, itemId, qty)`. Schema: zod validation; precondition checks: NPC exists in projection, player has the coins (for buy) or items (for sell), stock available, qty caps (1-10 per call).
- `src/app/api/character/route.ts` (modify) — return `coins` and `recentTrades`.
- `src/components/CoinBadge.tsx` — small global indicator next to EnergyBar showing coin count.
- `tests/unit/coins.test.ts` — pure helpers.
- `tests/integration/economy-trade.test.ts` — full buy + sell roundtrip; insufficient coins rejected; out-of-stock rejected.

**Pricing rule**: `sellPrice > buyPrice` always (markup is the central-bank "tax" that anchors prices). Initially: vendor catalogs hand-tuned in JSON so we can iterate without code changes.

**Acceptance**: Player approaches a vendor NPC → uses `trade_with_npc(npc_id, "buy", "iron_ore", 1)` → coins deducted, item added, `trade.completed` event logged. Reverse for selling. Insufficient funds returns a clean validation error.

**Gotchas**
- Anon coins on register need to migrate cleanly (extend `maybeClaimAnonSession` in `register/route.ts`).
- Don't expose vendor catalogs through the open API — only show what the player can see in their current location's projection.

### Day 20: Resource items + craft credits

**Schema migration `0033_craft_credits.sql`**
```sql
ALTER TABLE users ADD COLUMN craft_credits integer NOT NULL DEFAULT 10;
ALTER TABLE sessions ADD COLUMN craft_credits integer NOT NULL DEFAULT 10;
-- Range 0-9 logically, stored as 0-9. When an action would overflow to 10,
-- spend 1 energy and reset to 0 atomically.
```

**New files**
- `content/items/resources/` — resource items as JSON. ~20 to start: `iron_ore`, `copper_ore`, `silver_ore`, `wood_oak`, `wood_pine`, `herb_emberleaf`, `herb_silverroot`, `pelt_wolf`, `pelt_bear`, `crystal_arc`, `clay`, `cloth_linen`, etc. Each: `{ id, name, description, category: "resource", baseValue, rarity }`.
- `src/lib/economy/credits.ts` — `consumeCraftCredit(db, userId|sessionId)`: atomic — if `craft_credits < 9`, increment and return `{ spentEnergy: false, creditsRemaining: 10 - newValue }`; else, charge 1 energy and reset to 0. Returns `{ spentEnergy: true }`. Out of energy → reject with `out_of_energy_for_crafting`.
- `tests/unit/craft-credits.test.ts` — counter rollover, energy-spend boundary, out-of-energy reject.

**Acceptance**: 10 consecutive craft actions consume 1 energy total. The 11th waits until energy regens. UI shows the live counter.

**Gotchas**
- Don't double-charge: a single tool call is one credit, even if the tool produces multiple outputs.
- The `craft_credits` value is preserved across sessions; do NOT reset on login.

### Day 21: Gathering + location resource tagging

**Schema migration `0034_location_resources.sql`** (extends content, but the resource list lives in JSON not DB. The migration is for a runtime cache only):
```sql
-- No schema change — location resources are content-side, in
-- content/locations/<id>.json under `availableResources: string[]`.
```

**New files**
- `content/locations/<id>.json` (modify) — add `availableResources: ["iron_ore", "wood_oak"]` per location.
- New tool: `gather_resource(resourceId)` — produces 1-3 of the resource (rolled by the dice on a 2d6 + skill bonus); requires player's projection.location.id to have that resource available; consumes 1 craft credit.
- `src/lib/game/tools.ts` (modify) — add zod schema + precondition (location supports resource, player has skill if required, has credits/energy).
- `src/lib/economy/respawn.ts` — `availableResources` per location respawns every 100 turns of *world activity* (not per-player; tracked in a small `location_resource_state` table or on `worldNpcs`/locations metadata). For v1: assume infinite respawn; revisit if abuse becomes an issue.
- `tests/integration/gather.test.ts` — gather in correct location works; wrong location rejected; no skill rejected (after skills land).

**Acceptance**: Player in `iron_mine_depths` calls `gather_resource("iron_ore")` → 1-3 iron ore added to inventory, `craft.gathered` event logged, 1 credit consumed.

### Day 22: Smelting + smithing + recipes

**Schema migration**: none (recipes are content).

**New files**
- `content/recipes/` — JSON catalog. Each: `{ id, skill: "smithing"|"smelting"|"alchemy"|..., requiredLevel: number, inputs: [{ itemId, qty }], output: { itemId, qty }, xp, requiresLocation?: string }`. ~40 recipes to start covering smelting (ore → ingot), smithing (ingot → tool/weapon), woodcutting (raw → planks), alchemy (herbs → potion), cooking (ingredients → meal).
- New tools: `smelt(recipeId)`, `smith(recipeId)`, `craft(recipeId)` (the catch-all for non-smithing crafts). Each consumes inputs, produces output, awards skill XP, consumes 1 craft credit.
- `src/lib/economy/recipes.ts` — pure: validate (player has inputs, has skill at level, has credits, location matches if requiresLocation set).
- `tests/integration/recipes.test.ts` — full smelt + smith chain.

**Acceptance**: Player has 2 iron_ore, 1 coal → calls `smelt("iron_ingot")` → consumes inputs, adds 1 iron_ingot, awards 5 smelting XP, consumes 1 craft credit.

### Day 23-24: Skills + XP + NPC trainers

**Schema migration `0035_user_skills.sql`**
```sql
CREATE TABLE user_skills (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  xp integer NOT NULL DEFAULT 0,
  learned_at timestamptz NOT NULL DEFAULT now(),
  learned_from_npc_id text,
  UNIQUE (user_id, skill_id)
);
CREATE INDEX user_skills_user_idx ON user_skills (user_id);
```

**New files**
- `content/skills.json` — ~7 skills: `smithing`, `smelting`, `alchemy`, `farming`, `woodcutting`, `mining`, `cooking`. Each: `{ id, label, description, levelCurve: "standard" }`.
- `src/lib/economy/skills.ts` — pure: `xpToLevel(xp) = floor(sqrt(xp / 50))`. `awardXp(userId, skillId, amount)` atomic increment + level-up trigger event.
- New event kinds:
  ```ts
  | { kind: "skill.learned"; skillId: string; fromNpcId: string }
  | { kind: "skill.xp_gained"; skillId: string; amount: number }
  | { kind: "skill.leveled_up"; skillId: string; newLevel: number }
  ```
- New tool: `learn_skill_from(npcId)`. Validates: NPC has `metadata.teachesSkill`, player has met the NPC, player has enough coins (cost in NPC catalog), player doesn't already know the skill.
- `content/npcs/trainers/` — Master Halrik (smithing) in iron_reach, Mother Vael (alchemy) in herb_glade, etc. ~7 trainers, one per skill.
- `tests/unit/skills.test.ts` — XP curve, level-up trigger.
- `tests/integration/skills.test.ts` — learn from trainer; can't learn twice; XP awards level up.

**Level curve sample** (xp → level):
| level | total xp | turns to level (avg 5xp/craft) |
|---|---|---|
| 1 | 0 | (start) |
| 2 | 200 | 40 |
| 5 | 1250 | 250 |
| 10 | 5000 | 1000 |
| 20 | 20000 | 4000 |

Tuned so casual players hit level 5 in a long session, level 10 in a week, level 20 is a brag.

### Day 25: Buy/sell loop end-to-end

**No schema change.** This is integration + a tutorial seed.

**New files**
- `content/npcs/tutorial_vendor.json` — a tutorial vendor NPC in the starter zone with a hand-curated catalog (cheap iron ore buy, decent ingot sell, walks the player through the first profit cycle).
- `eval/scenarios/21-economy-loop.json` — gather → smelt → sell cycle, asserts coin gain and skill XP.

**Acceptance**: A new player can: gather 4 iron_ore → travel to town → smelt 2 iron_ingot (consumes 4 ore + coal) → sell 2 iron_ingot to vendor for net coin gain. Eval scenario green.

### Day 26: Economic balance + telemetry

**Schema migration `0036_economy_telemetry.sql`** (lightweight):
```sql
CREATE TABLE coin_flow_daily (
  date date NOT NULL,
  source text NOT NULL,            -- 'gather' | 'sell_to_vendor' | 'buy_from_vendor' | ...
  total_amount bigint NOT NULL DEFAULT 0,
  txn_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (date, source)
);
```

**New files**
- `src/lib/economy/telemetry.ts` — daily-rollup updater triggered on each `coins.*` event. Cheap upsert.
- `src/app/god/economy/page.tsx` — admin dashboard showing daily inflow vs outflow, top vendors by volume, total coins in circulation.
- Anti-farm guards:
  - Per-vendor daily coin-gain cap (`metadata.dailyCoinCap` per NPC).
  - Per-resource daily gather cap (`metadata.dailyGatherCap` per resource × user).
- `tests/integration/economy-balance.test.ts` — daily caps enforced; telemetry rollup correct.

**Acceptance**: Admin sees "today: 12,400 coins minted, 9,800 spent, net +2,600 in circulation, top earner Master Halrik 800 coins/sold". Caps prevent obvious exploits.

### Day 27: Skills/recipes UI + economy achievements

**No schema change.** UI + content.

**New files**
- `src/app/character/page.tsx` (extend) — Skills tab showing each skill, level, XP bar, recent level-ups. Recipe Book tab listing known + locked recipes (locked show requirement).
- `content/achievements.json` (extend) — economy entries: "First Smith", "Master Smelter (level 10)", "Hoarder (10,000 coins)", "Self-Made (earned coins from 5 different vendors)", etc.
- `content/objectives.json` (extend) — daily: "gather 20 wood", "smith an iron tool", "earn 100 coins selling".
- `tests/integration/economy-achievements.test.ts` — predicates fire on the right events.

**Acceptance**: Character page shows live skills/recipes/coins. New achievements unlock through normal play.

---

---

## Phase 5.5 — Engagement deepening (Day 28-37)

Each feature here is small but shifts the *felt* texture of the game: deaths matter, lives feel different, the world feels lived-in by other players, and new players survive their first 10 minutes.

### Day 28: Famous deaths ticker

**Why**: Right now dying = restart. Make notable deaths *legendary* — write a `world_lore` entry on memorable deaths so the homepage ticker reads "Yesterday: Embershade, the unburnt, was crushed by the Long Wyrm on turn 47." Compounds with the 24h-delayed lore page and the streak system: breaking a 5-day streak by death becomes its own piece of public lore.

**Schema**: none new. Reuses `world_lore` with `category: 'famous_death'`.

**New files**
- `src/lib/predicates/memorability.ts` — pure: given an event-log slice + projection, return `{ memorable: boolean, headline: string | null, salience: number }`. Triggers: died at <2 HP after 30+ turns, killed by named NPC, broke a 3+ day streak, died to own tool, first death of a brand-new form, longest run on the leaderboard ended.
- `src/lib/lore/famous-death.ts` — given `(memorability, projection, user)`, build a one-line summary (deterministic template, NOT LLM) and write to `world_lore`.
- Hook in `persistRunToWorld`: on death, evaluate memorability; if hit, write the lore entry.
- `src/components/FamousDeathsTicker.tsx` — homepage strip showing the last 5 famous deaths. Reads from `/api/lore/public` filtered to `category='famous_death'`.
- `tests/unit/memorability.test.ts` — predicate cases.
- `tests/integration/famous-deaths.test.ts` — kill a slime in turn-2 (not memorable), kill another at <2HP after 30 turns (memorable, lore written, ticker shows it after 24h).

**Acceptance**: A long, dramatic run ends in death → a famous-death lore entry is created → 24h later it appears on the homepage ticker. Trivial deaths (turn 1-2 starvation) don't trigger.

**Gotchas**
- Salience drives ticker ordering. Tune so the ticker doesn't drown in early-game deaths.
- Don't echo the player's username if they're anon. Use `reincarnatedAs` if set, else "an unnamed slime".

### Day 29: Reincarnation cooldowns

**Why**: Forces variety. Just died as a slime → can't pick slime again for 24h. Makes form choice feel like commitment, not a slot machine.

**Schema migration `0037_form_cooldowns.sql`**
```sql
ALTER TABLE users ADD COLUMN recent_form_deaths jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Shape: [{ formId: string, diedAt: string ISO timestamp }, ...]
-- Trimmed to last 7 days on every write.
```

**New files**
- `src/lib/forms/cooldown.ts` — pure: `coolingDown(recentDeaths, formId, now) → { cooling: boolean, untilMs: number | null }`. 24h cooldown per form.
- Hook in `persistRunToWorld` on death: append `{ formId, diedAt: now }` and trim entries older than 7d.
- `src/app/api/reincarnation/route.ts` (modify): filter cooldown forms from the picker; return them with `coolingDownUntilMs` so the UI can show a "available in 12h" hint instead of the form.
- `src/components/ReincarnationPicker.tsx` (modify): visible cooldown badges on locked forms.
- `tests/unit/form-cooldown.test.ts` — pure logic.
- `tests/integration/cooldown.test.ts` — die as slime → slime hidden from picker → 24h later slime returns.

**Acceptance**: Logged-in player dies as a lesser-slime → reincarnation picker shows "lesser-slime — available in 24h" greyed out → 24h later it's back.

**Gotchas**
- Anon sessions don't have form-history persistence; they get a session-scoped fallback (no cooldown — they only have one death anyway).
- Admin override: `/god/cooldown` to clear a user's cooldown list (for support).

### Day 30: Custom epitaphs

**Why**: A 1-sentence epitaph gives the player narrative agency at the moment that matters most. The epitaph becomes location-tied lore — future players passing through the same room read it.

**Schema migration `0038_epitaphs.sql`**
```sql
ALTER TABLE world_lore ADD COLUMN location_id text;
-- Enables location-scoped public reads of lore (epitaphs, notes-as-lore).
CREATE INDEX world_lore_location_idx ON world_lore (location_id) WHERE location_id IS NOT NULL;
```

**New files**
- `src/app/api/campaigns/[id]/epitaph/route.ts` — POST endpoint. Accepts `{ text }` (≤ 280 chars). Validates: campaign belongs to caller, campaign is dead, no epitaph already submitted, moderation pass via `lib/moderation`. Writes `world_lore` row with `category='epitaph'`, `location_id` from the death location, `summary` = the epitaph text.
- `src/components/Recap.tsx` (modify) — when status is 'dead', show a textarea: "your last words?" + submit button.
- `src/lib/locations/lore.ts` — given a locationId, return recent epitaphs (24h-delayed via `public_at` rule from Day 15). Surface via memory retrieval on turn 1 of new campaigns whose form starts in that location.
- `tests/integration/epitaph.test.ts` — submit on death; appears in next campaign's location memories after 24h; re-submit blocked.

**Acceptance**: Player dies → recap shows epitaph input → they write "i was almost something" → submit → 24h later, a new player who reincarnates in the same location sees it surface in their narration as remembered lore.

**Gotchas**
- 280-char cap mirrors Twitter; long enough for poetry, short enough to discourage griefing.
- Cannot edit after submission. Cannot submit on win/cap (epitaph is for the dead).

### Day 31: Custom item naming

**Why**: Tiny piece of player voice. The narrator already has a projection view; let the player rename items so the prose echoes their vocabulary.

**Schema**: none. Custom names live in projection state via existing `form_state.changed` (or a new dedicated event).

**New event kind**:
```ts
| { kind: "inventory.renamed"; itemId: string; customName: string }
```

**New files**
- New tool: `rename_inventory(itemId, name)`. Validates: player holds item, name 1-32 chars, moderation pass. Costs no energy (it's a UI affordance, not an action).
- `src/lib/game/projection.ts` (modify) — `inventory[].customName?: string`, populated from the event log. Default render: `customName ?? canonicalName`.
- Narrator system prompt (modify) — when items have custom names, instruct the narrator to use them: "the player has named this 'Marrow' — refer to it as such."
- `src/components/InventoryList.tsx` — inline-edit chip on each item: click → text input → submit → tool fires.
- `tests/integration/rename-inventory.test.ts` — rename, projection reflects, narrator uses custom name.

**Acceptance**: Player picks up rusted-dagger → names it "Marrow" → next narration references "Marrow" not "rusted dagger" until they drop or absorb it.

**Gotchas**
- Custom names persist with the item. If the item is dropped and re-picked-up by another player (unlikely in v1, possible with marketplace), name resets.
- Don't let players name items into prompt-injection — the existing moderation pipeline handles this since `rename_inventory` payload runs through `moderate(name)`.

### Day 32-33: Player notes in locations

**Why**: Dark Souls' biggest social mechanic was asynchronous messages. Players leave one-line notes pinned to a location ("there is fog ahead", "praise the sun"); other players passing through see them. Massive emotional payoff for tiny code surface.

**Schema migration `0039_location_notes.sql`**
```sql
CREATE TABLE location_notes (
  id uuid PRIMARY KEY,
  location_id text NOT NULL,
  form_id text,                         -- optional: notes can be form-specific
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  text text NOT NULL,                   -- ≤160 chars
  votes integer NOT NULL DEFAULT 0,
  flagged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
CREATE INDEX location_notes_location_active_idx ON location_notes (location_id, votes DESC) WHERE NOT flagged AND expires_at > now();

CREATE TABLE location_note_votes (
  note_id uuid NOT NULL REFERENCES location_notes(id) ON DELETE CASCADE,
  voter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, voter_user_id)
);
```

**New files**
- New tool: `leave_note(text)`. Costs 1 energy (notes have weight). Validates: text ≤160 chars, moderation pass, max 5 active notes per user globally, location matches projection. Inserts into `location_notes`.
- `src/app/api/locations/[id]/notes/route.ts` — GET: top 3 notes by votes (form-filtered if form set). POST `/[noteId]/vote` to upvote (one per user, idempotent).
- `src/lib/locations/notes.ts` — given a locationId+formId, returns the top-3 notes. Called on turn 1 / on `move_to` to inject notes into memory retrieval.
- `src/components/LocationNotes.tsx` — small panel under the vitals showing notes when present. Vote button per note.
- `tests/integration/notes.test.ts` — leave, read, vote (one per user), expiry hides note.

**Acceptance**: Player A leaves "the rat is faster than it looks" in `collapsed_tunnel` → Player B reincarnates as a slime in `collapsed_tunnel` → notes panel shows the message → narrator weaves "you remember a warning whispered here: the rat is faster than it looks" into the opening prose.

**Gotchas**
- Cap of 5 active notes per user prevents spam.
- 30-day auto-expiry keeps the note pool fresh.
- Voting requires login (anon can read but not vote).
- Flagged notes (3+ flags from distinct users) auto-hide pending admin review at `/god/notes`.

### Day 34-35: Named antagonist — Rhozell, the Wyrm's hand

**Why**: The Long Wyrm is a *force*; Rhozell is a *character*. Players need a villain with a name and a voice. Across runs, Rhozell remembers who killed him, who aided him, and shows up with the right attitude.

**Schema migration `0040_recurring_npcs.sql`**
```sql
ALTER TABLE world_npcs ADD COLUMN is_recurring boolean NOT NULL DEFAULT false;
ALTER TABLE world_npcs ADD COLUMN run_history jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Shape: [{ userId, sessionId, outcome: 'killed' | 'aided' | 'fled' | 'spared', at: ISO }, ...]
CREATE INDEX npcs_recurring_idx ON world_npcs (is_recurring) WHERE is_recurring;
```

**New files**
- `content/npcs/rhozell.json` — full personality card. Voice: vindictive, formal, eloquent. Mannerisms: cites the Wyrm in every third sentence. Topics: collecting debts, the Wyrm's slow waking, contempt for "soft forms". Faction: wyrm_loyal. Initial relationship: -2 (hostile until proven otherwise).
- `src/lib/antagonist/rhozell.ts` — appearance hook called on turn 1: probability of Rhozell showing up scales with `(arc.progress > 0.5) ? 0.15 : 0.03`. Increases by +0.05 if the user's run_history shows past Rhozell encounters (he's hunting them).
- `src/lib/antagonist/memory.ts` — pure: given Rhozell's `run_history` + the current user, generate a 1-line "history beat" the narrator weaves in: "Rhozell remembers your last face — a slime, drowned in the cistern. The grudge persists." Deterministic template, not LLM.
- Hook in `runTurn` step 6 (memory retrieval, turn 1): if Rhozell roll succeeds, add him to relevantMemories with the history beat + introduce him as an `npc.introduced` event.
- Hook in `applyTools` `update_relationship` for Rhozell: append to `run_history` on outcomes that matter (relationship hits ±3, NPC dies, etc.).
- `tests/unit/rhozell.test.ts` — appearance probability with/without history.
- `tests/integration/rhozell.test.ts` — kill Rhozell in run 1; he reappears in run 2 with grudge memory.

**Acceptance**: Player kills Rhozell in their first run as a slime → reincarnates as a dragon-egg → on turn 1, Rhozell (or an avatar) appears with "you remember the slime that ended me; this time will be different." Continuity across reincarnations.

**Gotchas**
- Rhozell can "die" multiple times — he's an avatar of the Wyrm's intent, not a single NPC. Dying just resets him with a remembered grudge.
- Don't auto-introduce on every turn — single appearance check, then Rhozell stays in projection like any other NPC.
- Tone-checker may flag Rhozell's voice if it's too far from the form's negativeVocab; whitelist his quoted dialogue from form-tone checks (he's an outsider's voice).

### Day 36-37: First-10-minutes guided slime tutorial

**Why**: First impression is everything. Right now a brand-new player hits /play and gets dropped into "you ooze in darkness" with no idea what to type. A 3-turn scripted intro teaches the wedge — *each form plays differently* — by having the slime do exactly the things only slimes do (ooze, sense vibration, absorb), with hints in the UI.

**Schema migration `0041_tutorial_state.sql`**
```sql
ALTER TABLE users ADD COLUMN tutorial_completed boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN is_tutorial boolean NOT NULL DEFAULT false;
```

**New files**
- `content/forms/tutorial-slime.json` — variant of lesser-slime with `tutorial: true` flag. Vitals tweaked (cohesion +2 so the player can't die on turn 1 by mistake).
- `content/locations/tutorial-tunnel.json` — copy of collapsed-tunnel with safer hard-moves and one obvious feature per turn.
- `src/lib/tutorial/script.ts` — turn-by-turn hints: turn 1 hint "try `ooze toward the slope`", turn 2 hint "try `sense the room`", turn 3 hint "try `absorb the moss`". Hints auto-fade after 30 seconds or first input.
- `src/lib/tutorial/graduate.ts` — on `session.ended` (any reason) for a tutorial session: set `users.tutorial_completed=true`, redirect to reincarnation picker.
- `src/app/api/auth/register/route.ts` (modify) — new users start a tutorial session by default. Existing users skip.
- `src/components/TutorialHint.tsx` — animated hint above the input box.
- `tests/integration/tutorial.test.ts` — fresh user → tutorial session → graduate → next session is normal.

**Acceptance**: Brand-new user completes registration → lands in tutorial-tunnel as a tutorial-slime with explicit hints → after 3 turns + a graduation event → tutorial_completed=true → next session is normal. Existing users opening a new session never see the tutorial.

**Gotchas**
- Tutorial sessions are excluded from leaderboards and meta-arc contributions (no farming the wyrm via newbie spam).
- Skipping is allowed: a "skip tutorial" link on the first turn marks completed=true and routes to reincarnation picker. We measure how many people skip vs complete; tune the script accordingly.
- Don't give bonus energy/coins for completing — the reward is the experience itself.

---

---

## Phase 7 — 365-day campaign calendar (Day 38-52)

**Source of truth**: `docs/STORY_BIBLE.md`. Read it before touching any of these files.

The story bible defines 12 monthly Books × 4 weekly Chapters = 48 chapters, 10 major branch decisions, 4 factions, ~15 recurring NPCs, and 6 endings. This phase wires the calendar engine, faction state, branch tracking, and content loaders so the bible drives the world. **Most of the *content* is then authored ongoing** — at ~1 chapter/week the year fills itself as it runs.

### Day 38: Calendar engine

**Schema migration `0042_world_calendar.sql`**
```sql
CREATE TABLE world_calendar (
  id integer PRIMARY KEY DEFAULT 1,    -- single-row table
  current_book integer NOT NULL DEFAULT 1,        -- 1..12
  current_chapter integer NOT NULL DEFAULT 1,     -- 1..48 (global)
  chapter_started_at timestamptz NOT NULL DEFAULT now(),
  year integer NOT NULL DEFAULT 1,
  CHECK (id = 1)
);
INSERT INTO world_calendar DEFAULT VALUES;
```

**New files**
- `content/story/chapters/<n>.json` — one per chapter. `{ chapterId, book, chapterInBook, weekStart, weekEnd, theme, worldEvent, branchDecisionId?, narratorPromptFragment, factionAlignmentBonuses, locationsAffected }`. Authoring plan: 4-8 chapters at a time, ahead of the active week.
- `src/lib/story/calendar.ts` — pure: `currentChapter(now, calendarRow) → ChapterContent`. Handles roll-over via timer (~7 days per chapter; configurable for accelerated test/preview).
- `src/lib/story/advance.ts` — cron-able job: every hour, check if it's time to roll the chapter. On roll: emit `chapter.advanced` event into a separate `world_events` table, evaluate any pending branch decisions, write a `world_lore` entry summarizing the new chapter's theme.
- `src/app/api/world/calendar/route.ts` — GET returns the current calendar state for the homepage.
- `src/components/CalendarBanner.tsx` — homepage banner showing current Book/Chapter + chapter title.
- `tests/unit/calendar.test.ts` — chapter math.
- `tests/integration/calendar-advance.test.ts` — chapter roll-over fires events.

**Acceptance**: Day 1 of deploy → calendar shows Book I Ch 1 "Strange Omens". Seven days later → calendar advances to Ch 2 with the corresponding world event firing.

### Day 39: Chapter prompt-fragment injection into narrator

**No schema change.**

**Files modified**
- `src/lib/narrator/remote.ts` — system prompt builder loads the current chapter's `narratorPromptFragment` and prepends it: tonal alignment + world-event awareness. Cached separately from per-form/per-location fragments so it has its own breakpoint and invalidates only on chapter change.
- `src/lib/narrator/template.ts` — TemplateNarrator gains a chapter-aware phrase bank (cheap deterministic version of the prompt fragment). Falls back to neutral when no chapter content authored.

**Acceptance**: Active chapter's flavor reaches the narrator's output. Slime in Book I Ch 1 narration mentions or alludes to the Red Moon (deterministic check via eval scenario).

### Day 40-41: Faction state

**Schema migration `0043_factions.sql`**
```sql
CREATE TABLE factions (
  id text PRIMARY KEY,                           -- 'choristers' | 'rust_hand' | 'idle' | 'forsaken'
  label text NOT NULL,
  member_count integer NOT NULL DEFAULT 0,
  cumulative_contribution integer NOT NULL DEFAULT 0,  -- abstract pool driving branch outcomes
  active boolean NOT NULL DEFAULT true,           -- forsaken inactive until Branch IV=A
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO factions (id, label, active) VALUES
  ('choristers', 'The Choristers', true),
  ('rust_hand', 'The Rust Hand', true),
  ('idle', 'The Idle', true),
  ('forsaken', 'The Forsaken', false);

ALTER TABLE users ADD COLUMN faction_id text REFERENCES factions(id);
ALTER TABLE users ADD COLUMN faction_pledged_at timestamptz;

CREATE TABLE faction_contributions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  faction_id text NOT NULL REFERENCES factions(id),
  chapter_id integer NOT NULL,
  amount integer NOT NULL,
  source text NOT NULL,             -- 'ritual' | 'gather' | 'craft' | 'kill_npc' | 'edict' | ...
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX faction_contrib_chapter_idx ON faction_contributions (chapter_id, faction_id);
```

**New files**
- New tool: `pledge_faction(factionId)`. Costs 50 coins. Validates: faction is active, player isn't already pledged. Writes the `faction.pledged` event.
- `src/lib/story/factions.ts` — pure helpers + atomic DB ops for pledge/contribute/leave. Faction perks (XP bonuses) read from this on craft/gather paths.
- `src/lib/story/contribute.ts` — `recordContribution(userId, factionId, source, amount)` — appends row, increments cumulative.
- `src/app/api/factions/route.ts` — GET (list, public), POST `/pledge`, POST `/leave`.
- `src/components/FactionPanel.tsx` — character page section showing player's faction + a public faction-comparison panel showing aggregate.
- `tests/integration/factions.test.ts` — pledge, contribute, totals roll up correctly per chapter.

**Acceptance**: Player pledges Choristers via tool → user record updated, `faction.pledged` event logged, Choristers `member_count` increments, faction-aligned crafting (alchemy/smelting/smithing) gets +10% XP.

### Day 42: Branch decision tracking

**Schema migration `0044_branch_decisions.sql`**
```sql
CREATE TABLE branch_decisions (
  id integer PRIMARY KEY,           -- 1..10 (Branches I..X)
  chapter_id integer NOT NULL,
  question text NOT NULL,
  paths jsonb NOT NULL,             -- [{ id, label, threshold_metric }, ...]
  resolved_path text,                -- null until chapter ends
  resolved_at timestamptz,
  resolution_data jsonb              -- snapshot of the metrics at resolution
);
```

**New files**
- `content/story/branches/<n>.json` — one per branch. `{ id, chapterId, question, paths, defaultPath, metric }`.
- `src/lib/story/resolve-branch.ts` — pure: given branch definition + faction contributions + other state, compute the winning path. Writes `branch.resolved` event + persists outcome to `branch_decisions.resolved_path`.
- Hook in calendar advance: when a chapter with a branch ends, resolve immediately (synchronously, in the advance job).
- `src/lib/narrator/branch-context.ts` — exposes resolved branch outcomes to subsequent chapter's narrator prompt fragment.
- `src/app/world/branches/page.tsx` — public read of resolved branches as world history.
- `tests/integration/branch-resolution.test.ts` — synthesize contributions, advance chapter, verify correct path resolves.

**Acceptance**: Branch I (Ch 4) resolves at chapter advance. The chosen path becomes part of the world's persistent state. Subsequent chapters' narrator prompts reference it.

### Day 43-44: Recurring NPC engine + appearance probability

**Schema migration `0045_recurring_npc_appearances.sql`** (extends Phase 5.5 Day 34-35):
```sql
CREATE TABLE npc_appearances (
  id uuid PRIMARY KEY,
  npc_id text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid,
  chapter_id integer,
  outcome text,                    -- 'killed' | 'aided' | 'fled' | 'spared' | 'unresolved'
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX npc_app_user_npc_idx ON npc_appearances (user_id, npc_id);
```

**New files**
- `content/npcs/recurring/` — Aelnea Vren, Mhirosh Rust-Tongue, the Witness, Cipher, Cinder, the Salt-Tongue, etc. Each: full personality card + chapter-gated appearance rules.
- `src/lib/story/recurring-npcs.ts` — pure: `pickAppearance(userId, sessionContext, chapter, history) → npcId | null`. Uses chapter-defined NPC rotation + per-user history weighting (more likely to see NPCs you have history with).
- Hook in `runTurn` step 6: if appearance fires, inject NPC's history beat into `relevantMemories` + emit `npc.introduced` event.
- `tests/unit/recurring-npc-pick.test.ts` — chapter rotation, history weighting.
- `tests/integration/recurring-npcs.test.ts` — Aelnea appears in Ch 4; Cipher appears in Ch 2 and Ch 6.

**Acceptance**: Recurring NPCs appear at the right chapters with appropriate dialogue. Cross-run grudge memory works for all of them, not just Rhozell.

### Day 45-46: Wyrm raid integration with story branches

**Files modified**
- `src/lib/meta/long-wyrm.ts` (extend Day 13 work) — Branch V (Ch 20) reads Wyrm HP at chapter end. If HP > X% → "Asleep"; X-Y% → "Half-Wakes"; <Y% → "Wakes Early" (compresses Book VI).
- `src/lib/story/branch-v.ts` — wires the raid outcome to the calendar.
- New world_event hook: "wakes early" causes `chapter_compress` event that tells the calendar to skip Ch 21-23.

**Acceptance**: Players who hit the Wyrm hard enough collapse the mid-year arc by 3 weeks. Slow raids let the world breathe.

### Day 47: The Three Votes (Books XI-XII machinery)

**Schema migration `0046_year_votes.sql`**
```sql
CREATE TABLE year_votes (
  id integer PRIMARY KEY,           -- 1, 2, 3 (Votes 1-3)
  chapter_id integer NOT NULL,
  question text NOT NULL,
  options jsonb NOT NULL,
  tally jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_option text,
  resolved_at timestamptz
);
```

**New files**
- `src/lib/story/votes.ts` — at the chapter where a Vote opens, freeze faction memberships + tally contributions; at chapter end, resolve.
- `src/components/CounselVoteBanner.tsx` — homepage banner showing live vote tallies during Book XI.
- `tests/integration/votes.test.ts` — tally accumulates; resolution snapshot matches.

**Acceptance**: At Day 308, Vote 1 opens with live tally visible to all players. At Day 314, it resolves; result locks for the rest of the year.

### Day 48: Endings machinery

**Schema migration `0047_year_endings.sql`**
```sql
CREATE TABLE year_endings (
  year integer PRIMARY KEY,
  ending_id text NOT NULL,           -- 'renewal' | 'echo' | 'hollow' | 'mortal' | 'inversion' | 'long_sleep'
  resolved_at timestamptz NOT NULL DEFAULT now(),
  vote_outcomes jsonb NOT NULL,
  faction_final_state jsonb NOT NULL,
  notable_players jsonb NOT NULL     -- top contributors, first-to-sit, etc.
);
```

**New files**
- `content/story/endings/<id>.json` — one per ending. Narrative description, mechanical effects on Year 2.
- `src/lib/story/endings.ts` — `resolveYearEnding(year, calendar, votes, factions, etc.) → endingId`. Pure synthesis of all year-state.
- Hook in calendar advance for Ch 48: trigger the ending resolution + write a comprehensive `world_lore` entry "the year ended in *X*".
- Year 2 seed: when the new year begins, load the previous year's ending + apply its modifiers (Renewal: rebalanced forms; Echo: permadeath default; etc.).
- `src/app/world/year/[n]/page.tsx` — public year-summary page. Becomes the historical record.

**Acceptance**: At Day 365, the year resolves into one of 6 endings. The page is a permanent monument. Year 2 begins with the right starting state.

### Day 49: First-to-Sit + Edicts (Book X support)

**Files modified**
- `content/locations/hollow_throne.json` — the Throne location, gated behind a quest chain referencing the Ch 2 hand-cuff item.
- `src/lib/story/throne.ts` — `claimThrone(userId)` — atomic; only succeeds for the first player. Awards permanent title "The First to Sit". Records in lore.
- `src/lib/story/edicts.ts` — promote a player note to an Edict (location-bound mechanical modifier). Validates: player's faction holds territory in that location.
- `tests/integration/throne.test.ts` — race-safety: 100 concurrent claims, exactly 1 succeeds.

### Day 50: World event scheduling (the synchronized "Voice" wonder)

**Schema migration `0048_world_events.sql`**
```sql
CREATE TABLE world_events (
  id uuid PRIMARY KEY,
  kind text NOT NULL,              -- 'chapter_advanced' | 'red_moon' | 'wyrm_voice' | ...
  scheduled_at timestamptz NOT NULL,
  fired_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX world_events_pending_idx ON world_events (scheduled_at) WHERE fired_at IS NULL;
```

**New files**
- `src/lib/story/world-events.ts` — scheduler + dispatcher. Pre-schedules the year's major events (Ch 23 Wyrm Voice, Ch 38 First-to-Sit window opens, etc.) at deploy time.
- Hook in cron: every minute, dispatch any due event. For Wyrm Voice: format a per-player line via Haiku 4.5, inject into next turn's narration.
- `tests/integration/world-events.test.ts` — schedule, dispatch, payload reaches narrator.

**Acceptance**: The Day 165 Wyrm Voice event fires synchronously across all active sessions. Each player receives a personalized line in their next turn's narration.

### Day 51: Story content authoring tooling

**No schema change.**

**New files**
- `scripts/author-chapter.ts` — CLI tool: `npx tsx scripts/author-chapter.ts new --chapter 5` scaffolds a `content/story/chapters/5.json` with the bible's prescribed shape, leaving the prose for the human author.
- `scripts/validate-chapters.ts` — checks all 48 chapters for required fields, references valid factions/branches/locations, prompt fragments under length cap.
- `eval/scenarios/22-chapter-tone.json` — eval that verifies the active chapter's tonal flavor reaches the narrator output. Run every chapter advance.
- `docs/AUTHORING.md` — short guide for content authors covering bible references, voice rules, chapter file shape.

**Acceptance**: Content authoring is a 2-hour workflow per chapter, not a day. Validation catches missing references before deploy.

### Day 52: Story arc admin dashboard

**No schema change.** (Read-only over existing tables.)

**New files**
- `src/app/god/story/page.tsx` — admin view of the calendar, faction balance, branch outcomes, scheduled world events, recurring NPC appearance counts. Lets you manually advance / retreat the calendar for testing or live ops.
- Buttons: "advance one chapter", "rollback chapter (with caveat)", "force resolve branch", "retire NPC", "schedule custom world event".

**Acceptance**: A new branch can be added live via the admin dashboard mid-year if data shows player actions don't fit the planned paths.

### Day 53: Catch-Up Codex (mid-year entry)

**Why**: World clock locked at 1:1 (ADR-019). New players joining on Day 87 walk into Book III Ch 12 — they don't get to play Book I. The Codex is how they catch up: an auto-generated condensed briefing of every chapter and branch resolution before their entry point.

**Schema migration `0049_catchup_codex.sql`**
```sql
CREATE TABLE chapter_summaries (
  chapter_id integer PRIMARY KEY,
  year integer NOT NULL DEFAULT 1,
  summary_short text NOT NULL,        -- 1-2 sentences for the Codex
  summary_long text NOT NULL,         -- paragraph with the chapter's flavor
  branch_outcome jsonb,                -- if this chapter had a branch, the resolved path
  notable_deaths jsonb,                -- top famous deaths from the chapter
  generated_at timestamptz NOT NULL DEFAULT now()
);
```

**New files**
- `src/lib/story/codex.ts` — at chapter advance, generate the summary via Haiku 4.5 (cheap, one call per chapter advance, deterministic seed). Pulls from: chapter content, resolved branch, top famous deaths, faction-state snapshot. Cached forever in the table.
- `src/app/codex/page.tsx` — Catch-Up Codex page. Shows every chapter through the player's join-week as a scrollable timeline. New players see this on first login if they joined after Book I. Existing players can browse it any time.
- `src/components/CodexEntry.tsx` — chapter card with the short/long summary + collapsed details.
- Hook in registration (Day 1 of player) — if `world_calendar.current_chapter > 1`, mark the user with `needs_codex_briefing=true` and route to `/codex/welcome` first.
- `tests/integration/codex.test.ts` — chapter advances generate summaries; codex page renders correctly for a Day-87 join.

**Acceptance**: A user registers on Day 87 → first hits `/codex/welcome` → reads condensed lore for Books I, II, and Ch 9-12 of Book III → graduates into normal play. Existing players can revisit Codex any time via a nav link.

**Gotchas**
- Don't auto-show Codex on every login — only first registration mid-year. Veterans hate forced briefings.
- Generation is one-shot per chapter on advance; never regenerate. The summary is canon.
- Codex summaries are public; they appear on the Year Archive page (next day) and in OG previews.

### Day 54: Year Archive (Year 1 → readable history when Year 2 begins)

**Why**: A real-time year is a real-time year — but once it's done, it should become *history*, not vanish. The Archive lets Year-2 players read Year 1 like a book; lore that decayed in live play is preserved here forever; the year's outcome (Renewal / Echo / Hollow / Mortal / Inversion / Long Sleep) gets a dedicated monument page.

**Schema migration `0050_year_archive.sql`**
```sql
CREATE TABLE year_archives (
  year integer PRIMARY KEY,
  ending_id text NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  full_summary text NOT NULL,
  faction_final_state jsonb NOT NULL,
  notable_players jsonb NOT NULL,      -- first-to-sit, top contributors, top epitaphs
  notable_deaths jsonb NOT NULL,
  branches_resolved jsonb NOT NULL,
  voice_recordings jsonb DEFAULT '[]'::jsonb,  -- the Wyrm Voice lines from that year
  permanent_lore_ids bigint[]          -- world_lore ids that survived decay
);
```

**New files**
- `src/lib/story/archive.ts` — at end-of-year (Ch 48 advance), snapshot everything into `year_archives`. Idempotent.
- `src/app/world/year/[n]/page.tsx` — public year-summary page. Renders the year as a long-form story: cosmology recap, the 12 Books, the resolved branches, the ending. Shareable URL with OG image showing the ending.
- `src/app/world/archive/page.tsx` — index of all archived years.
- `src/lib/story/year-2-seed.ts` — at Year 2 start (Day 366), read Year 1 archive + apply Year 2 modifiers per the ending (Renewal: rebalanced forms; Echo: permadeath default; etc.).
- `tests/integration/year-archive.test.ts` — simulate year-end; archive populates; Year 2 starts with correct seed.

**Acceptance**: Day 365 ends → Day 366 begins as Year 2 with the right ending applied → `/world/year/1` is a beautifully rendered permanent record. Year 2's new players can read it like a creation myth.

### Day 38 addendum (calendar engine): pause + countdown

**Already covered in Day 38**, but the spec needs to be explicit about pause + UI countdown:
- Pause: admin-only toggle in `/god/story`. When paused, `world_calendar.paused_at` is set; `chapter_started_at` is bumped by the pause duration on resume. UI banner shows "the calendar is paused" while engaged.
- UI countdown: every page (or at least the homepage and `/play`) shows "next chapter in 3d 4h 12m". Driven by `chapter_started_at + 7 days`. Always-visible reminder that time matters.
- Test/preview: `STORY_TIME_FACTOR` env var. Default unset (1 chapter = 7 days). In staging, set to e.g. 0.01 → 1 chapter = ~1.7 hours, so a full year runs in ~6 days for QA. **Production hard-codes the factor to 1.** Validation in env.ts rejects non-1 in production.

### Phase 7 ongoing: weekly chapter authoring

After Day 54, the calendar is running and the catch-up + archive infrastructure is in place. Each Chapter then takes 2-4 hours of human authoring per week. Maintain a 4-chapter buffer ahead of "now" so we always have content ready. This is steady-state work, not a milestone.

**Failure modes to watch for**
- Chapter content slipping below 2-week buffer → calendar hits an empty chapter → fallback to TemplateNarrator + a generic "the world is quiet this week" theme. Not great, but doesn't break the game.
- Branch outcome ties → defaults fire (defined per branch in `content/story/branches/<n>.json`).
- Faction balance flatlines → admin nudges via `god/story` dashboard. Or accept that some years are quiet.
- Sustained engagement collapse → Long Sleep ending fires legitimately. Year 2 becomes a soft-reboot. Not a bug — the world reflects who showed up.

---

## Phase 6 — Player-driven economy + ascension (deferred, ~Month 2)

Two parallel month-2 milestones. Marketplace is gated on Phase 5 telemetry; ascension is gated on aggregate run counts (need ~50+ veteran players for it to matter).

### 6a — Player-driven marketplace (~7 days)

Once the central-bank phase has run for ~30 days and we have data on coin flow, open the player marketplace. **Do not start until Phase 5's telemetry shows stable inflow/outflow.**

**Outline**
- Schema: `marketplace_listings` (sellerId, itemId, qty, askPrice, postedAt, expiresAt, soldAt, buyerId).
- New tools: `list_for_sale(itemId, qty, price)`, `buy_listing(listingId)`, `cancel_listing(listingId)`.
- Per-listing fee (1-5%) routed to the central bank — sinks player-to-player coin flow back into NPC vendor pools, prevents pure deflation.
- UI at `/market`: search, sort by price, filter by category. Live inventory.
- Anti-griefing: max active listings per user, listing expiry (24-72h), auto-refund of unsold qty.
- Vendor NPCs continue to exist as floor/ceiling anchors — they buy any common resource at base value, sell common resources at base × 1.5.

**Decision pending**: marketplace fee % and the cap on active listings. Set after Phase 5 data lands.

### 6b — Ascension (endgame; ~7-10 days)

**Why**: Veterans need an endgame. After ~50 completed runs the game has shown its full deck; ascension offers a meaningful next step — pick a previous form and unlock its *Ascendant* variant (slime → Slime Ascendant; cursed-book → Tome Eternal). Modified vitals, new verbs, new hard-moves, often a new starter location.

**Schema migration (sketch)**
```sql
ALTER TABLE users ADD COLUMN ascensions jsonb NOT NULL DEFAULT '[]'::jsonb;
-- [{ baseFormId, ascendantFormId, unlockedAt, runsAtUnlock }, ...]
ALTER TABLE users ADD COLUMN ascension_credits integer NOT NULL DEFAULT 0;
-- Earned per completed run; spent to unlock ascensions.
```

**Outline**
- Eligibility: 50 total completed runs (any reason: death/win/cap counts), accumulate `ascension_credits` 1 per completed run from run #50 onward.
- Catalog: `content/ascendants/<form_id>.json` per ascendable form. Initial scope: 5 ascendants (slime, cursed-book, dragon-egg, dungeon-core, healer). New verbs/stats/hard-moves authored at Phase 5/6 polish quality.
- Unlock UI at `/character/ascend`: pick a base form you've played, spend ascension_credits (cost scales: first ascendant 5 credits, second 10, third 20...) to unlock.
- Reincarnation picker shows ascendants as a separate tier; choosing one feels distinct.
- Achievements + titles: "First Ascendant", "Tome Eternal pilgrim", etc.

**Open questions**
- Does ascension consume the base form (you can no longer play lesser-slime once ascended)? Default: NO — ascendants are *additions*, not replacements.
- Do ascendants' famous deaths get a different ticker treatment? Default: yes — `category='ascendant_death'` with bigger headlines.
- Permadeath option for hardcore? Default: defer.

**Estimated**: 7-10 days. Mostly content authoring (5 ascendant forms × ~1 day each) plus 2-3 days of unlock + UI plumbing.

---

## Stretch (Days 28+)

Each is a multi-day milestone; treat them independently.

### NPC dialogue system

**Goal**: Promote NPC dialogue from "the narrator describes what an NPC says" to a first-class pipeline with personality continuity.

**Outline**
- New tool: `dialogue_with_npc(npcId, what_player_says)`. When the model emits this, the orchestrator:
  1. Loads the NPC's `personality_card` + recent dialogue history (new `npc_dialogue_log` table — separate from event log to keep events tidy).
  2. Calls Haiku 4.5 with a small NPC-voice prompt (the personality card + last 3 exchanges + what the player just said) → returns `{ npcLine, relationshipDelta, mood }`.
  3. Writes a `dialogue.exchanged` event into the main event log; updates the dialogue table.
  4. The main narrator gets the NPC's line in its `relevantMemories` so it can frame the scene around it.
- Schema: `npc_dialogue_log` table; `dialogue.exchanged` event kind.
- Cost: ~$0.001 per exchange (Haiku, small prompt). Acceptable.

**Estimated**: 3-5 days.

### Player-authored forms (with admin approval)

**Goal**: Let players submit form templates. They sit in a queue; admins (initially: just you) approve.

**Outline**
- Schema: `form_submissions` table — stores YAML/JSON, status (`pending|approved|rejected`), `reviewed_by`, `reviewed_at`.
- New page `/forge` — form authoring UI with live JSON editor + preview pane that runs a synthetic 1-turn TemplateNarrator preview.
- Validation: existing `FormTemplate` zod schema + a content-policy moderation pass (re-uses `lib/moderation`).
- Admin queue at `/god/forms` — approve flips status + writes the JSON into `content/forms/<slug>.json` (committed via git? or runtime-loaded from DB? Decide before starting).
- Telemetry: track plays of player-authored forms separately from canon forms.

**Estimated**: 5-7 days.

**Decision pending**: do approved forms live in the repo (git commit) or in DB? Repo gives review/audit, DB gives instant deploy. Lean toward DB for v1.

---

## Cross-cutting work that benefits everything

### Predicate engine telemetry
Every predicate evaluation emits a `predicate.evaluated` log line with `{ predicateId, matched, evidenceCount, durationMs }`. Wire into the existing `log` shipper. Cheap, lets us spot expensive achievements / objectives later.

### Public profile page
`/u/[username]` — read-only view of a player's titles, achievements, top forms, recent runs. Reuses share-token logic. Day 5 and Day 10 unlock most of this; the page itself is one afternoon.

### Friends list (eventual)
Currently gifts are username-targeted with no friends concept. If we want a "friends online now" feed, we need a `friendships` table (mutual + symmetric). Not in this 14-day plan; revisit if gifting + presence demand it.

### Eval coverage for new features
- Legacy traits: a scenario where a slime drowns then a book is reincarnated → assert `form.state.water_affinity == 1` on turn 1.
- Achievements: synthetic event log → assert specific unlocks.
- Predicate engine: covered by unit tests.
- Companions: scenario where bond fires → next campaign retrieves them.
- Mood presets: same seed, three runs, three measurably different texts. Use the LLM judge.

---

## Order of operations summary

```
Day 1-2   predicate engine ──────┐
Day 3     legacy traits          │
Day 4     achievements ──────────┴── shared infra
Day 5     titles
Day 6     daily/weekly objectives ───┘
Day 7-8   companion NPCs
Day 9     gifting
Day 10    replay / share
Day 11    mood presets
Day 12    adaptive difficulty
Day 13    world-boss raids
Day 14    scene images
Day 15    public world lore (24h delay) ────┐
Day 16    foreshadowing memory plants       ├── engagement adds
Day 17    wonder events                     ┘
Day 18-19 economy: currency + NPC vendors ──┐
Day 20    resource items + craft credits    │
Day 21    gathering + location tagging      │
Day 22    smelting + smithing + recipes     ├── Phase 5: economy + crafting
Day 23-24 skills + XP + NPC trainers        │   (central-bank stabilized)
Day 25    buy/sell loop end-to-end          │
Day 26    economic balance + telemetry      │
Day 27    skills/recipes UI + achievements ─┘
Day 28    famous deaths ticker ─────────────┐
Day 29    reincarnation cooldowns           │
Day 30    custom epitaphs                   │
Day 31    custom item naming                ├── Phase 5.5: engagement deepening
Day 32-33 player notes in locations         │
Day 34-35 named antagonist (Rhozell)        │
Day 36-37 first-10-minutes tutorial ────────┘
Day 38    calendar engine ──────────────────┐
Day 39    chapter prompt fragment           │
Day 40-41 faction state                     │
Day 42    branch decision tracking          │
Day 43-44 recurring NPC engine              ├── Phase 7: 365-day campaign (story bible)
Day 45-46 Wyrm raid → Branch V wiring       │
Day 47    Three Votes machinery             │
Day 48    endings machinery                 │
Day 49    First-to-Sit + Edicts             │
Day 50    scheduled world events            │
Day 51    story authoring tooling           │
Day 52    story admin dashboard             │
Day 53    Catch-Up Codex                    │
Day 54    Year Archive ─────────────────────┘
Day 55+   NPC dialogue (3-5d)
Day 60+   player-authored forms (5-7d)
Day 67+   Phase 6a: player-driven marketplace (~7d)
Day 67+   Phase 6b: ascension (~7-10d, parallel to 6a)
+ ongoing: weekly chapter authoring (~2-4h/week, 4-chapter buffer)
```

**Calendar pacing** (ADR-019): 1 chapter = 7 real days UTC. The world clock runs at 1:1 throughout. Phase 7 build (Day 38-54) takes ~17 dev days; the *story* it powers takes 365 real days to play through.

Each day ships a green build with unit + integration tests, lint clean, and merged to master via the standard branch + push + merge flow. No skipping local CI.

## Open decisions

| # | Decision | Default if not raised |
|---|---|---|
| 1 | Player-authored forms: DB or repo storage? | DB |
| 2 | Image provider: Replicate Flux vs Anthropic image-out? | Replicate Flux Schnell (cheap, GA today) |
| 3 | Companion personality card: generated once at bond, or refreshed periodically? | Once at bond |
| 4 | Adaptive difficulty: applies to anon sessions too? | Yes |
| 5 | Mood preset: per-campaign or per-user? | Per-user with per-campaign override |
| 6 | World boss raid rewards: cosmetic title only, or also unlocks a form? | Title only for v1 |
| 7 | Run-share visibility: public-by-link vs requires-account? | Public-by-link |
| 8 | Public lore delay: 24h fixed, or graduated by salience (high salience surfaces sooner)? | 24h fixed for v1; revisit in Phase 6 |
| 9 | Wonder fire rate: 1% per turn, or weighted by form-rarity / streak / mood? | 1% flat for v1 |
| 10 | Anon coin pool: claimable on register, or forfeit? | Claimable (mirror anon-session-claim flow) |
| 11 | Skill carries across reincarnations: yes (per-user) — locked. | Yes |
| 12 | Resource respawn: per-location turn-count, real-time, or never (infinite)? | Infinite for v1; add caps in Day 26 telemetry pass |
| 13 | Marketplace fee %: ? | TBD after Phase 5 data |
| 14 | Marketplace listing cap per user: ? | TBD after Phase 5 data |
| 15 | Famous-death predicate threshold: which deaths qualify? | The 6 hand-picked predicates in Day 28; tune via salience telemetry |
| 16 | Reincarnation cooldown duration: 24h, 12h, or per-form-rarity? | 24h flat for v1 |
| 17 | Custom epitaph max length: 280 chars (Twitter-style) or 500 (more poetry)? | 280 for v1 |
| 18 | Item rename persistence: stays with item even if dropped/traded, or resets? | Resets on transfer (relevant when marketplace lands) |
| 19 | Player-note voting: any logged-in user, or require to have visited the same location? | Any logged-in for v1 |
| 20 | Rhozell appearance probability tuning: flat 5%, scaled by run history, or arc-progress-gated? | 3% baseline, +5% if grudge history exists, gated to arc.progress > 0.3 |
| 21 | Tutorial: mandatory or skippable? | Skippable (skip link on turn 1) |
| 22 | Ascension cost curve: linear (5,10,15...) or geometric (5,10,20,40)? | Geometric for v1 — keeps the carrot visible |
| 23 | Ascendant base forms: keep 5 (slime/book/egg/core/healer) or expand to all 50+ in batch 2? | 5 for v1; expand if data shows demand |
| 24 | Chapter duration: hard 7 days, or floats based on player engagement? | Hard 7 days for v1 — predictability is more important than reactive pacing |
| 25 | Calendar acceleration: admin can compress for testing/preview? | Yes via `/god/story` dashboard; never compress on prod |
| 26 | Branch tie-break rule: tie → default path, or coin flip? | Default path (deterministic; prevents griefing via deliberate ties) |
| 27 | Faction switching: allowed or one-shot? | One-shot for Year 1; allow in Year 2 with cost |
| 28 | Forsaken permadeath: irreversible, or "true death" only on second confirmation? | Two-step confirm; first death → admin notification, second → real |
| 29 | Year-2 starting state: full carry-over of all individual progress, or partial reset? | Carry coins + skills + ascensions; reset bad_luck + active campaigns |
| 30 | Failed-engagement "Long Sleep" ending threshold: 100 active players, or smaller? | 100 for v1; revisit after watching Books I-V engagement |
| 31 | Codex briefing: forced for mid-year joiners, or skippable on registration? | Forced once on first login; skippable thereafter |
| 32 | Year Archive write timing: at Ch 48 advance, or after a 7-day "wake" period? | At Ch 48 advance; lore is final at year-end |
| 33 | Pause-during-chapter: extends chapter by pause duration, or chapter still rolls at the wall-clock 7d mark? | Extends — chapters are 7 days of *active* time |
| 34 | `STORY_TIME_FACTOR` allowed values in non-prod: any positive float, or specific tiers (1.0 / 0.1 / 0.01)? | Any positive float; env validator rejects non-1.0 in prod |

Resolve as features come up. Update `docs/DECISIONS.md` with chosen path.
