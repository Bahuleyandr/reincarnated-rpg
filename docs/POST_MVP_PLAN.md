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

Days 15+ are the **bigger swings** that don't fit a single-day box: NPC dialogue system (3-5 days), player-authored forms (5-7 days). Treat them as independent milestones after Day 14 lands.

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

## Stretch (Days 15+)

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
Day 1-2  predicate engine ──────┐
Day 3    legacy traits          │
Day 4    achievements ──────────┴── shared infra
Day 5    titles
Day 6    daily/weekly objectives ───┘
Day 7-8  companion NPCs
Day 9    gifting
Day 10   replay / share
Day 11   mood presets
Day 12   adaptive difficulty
Day 13   world-boss raids
Day 14   scene images
Day 15+  NPC dialogue (3-5d)
Day 20+  player-authored forms (5-7d)
```

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

Resolve as features come up. Update `docs/DECISIONS.md` with chosen path.
