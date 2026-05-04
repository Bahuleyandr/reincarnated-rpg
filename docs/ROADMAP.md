# Roadmap

Source of truth for what is in-flight and what is next. Update as days complete.

## Current milestone — M1 (Week 1)

Goal: TemplateNarrator playable end-to-end (no AI). Anonymous player completes a 10-turn slime run with deterministic phrase-bank narration.

| Day | Status | Output |
|---|---|---|
| 1 | done (2026-05-03) | Repo init, deps installed, configs/docs/CLAUDE/README authored, `content/forms/lesser-slime.json` authored in full (negative vocab + hard-move menu + sample corpus), private GitHub repo created. Baseline commit. |
| 2 | done (2026-05-03) | Drizzle schema (10 tables) at `src/lib/db/schema.ts`. Migration `0000_init.sql` enables pgvector, creates tables/enums/indexes, and installs the events append-only trigger (raises on UPDATE/DELETE). `scripts/seed.ts` + `scripts/load-env.ts` (tiny dotenv replacement). `content/locations/collapsed-tunnel.json` (6 rooms incl. exit fissure). 11 schema-round-trip tests passing. `.env.example` documents the WSL2 localhost-forwarding gotcha. |
| 3 | done (2026-05-03) | `src/lib/game/types.ts` (Event union, ToolCall, Projection, FormTemplate, LocationTemplate, Narrator). `projection.ts` reducer covers all 22 event kinds; `initialProjection` seeds vitals from form template + `vitalsMax` for clamps; `applyEvents` folds; `loadProjection`/`writeSnapshot` use snapshot+delta. `events.ts` append (single-tx, seq-guarded) + readLog + rowToEvent split/merge for the seed column. 39 new tests (25 reducer pure + 14 event-log integration); 58 total green. Typecheck clean. |
| 4 | done (2026-05-03) | `src/lib/util/rng.ts` (mulberry32 + deriveSeed). `src/lib/game/rules.ts` (2d6 + bands + rollFromDice). `src/lib/game/sanitize.ts` (control-strip + NFC + length cap). `src/lib/game/tools.ts` (Zod registry for 16 tools + atomicity-failure path: emit tool_validation_failed + retry signal). `eval/runner.ts` skeleton (loads + validates scenarios). 100 tests green (66 unit + 34 integration). |
| 5 | done (2026-05-03) | `content/beats/survive-the-night.json` (5 beats: awakening, the-rat, the-choice, predator-stirs, dawn — triggers branch on action history, not turn order alone). `src/lib/game/beats.ts` (matcher with all/any/leaf DSL over dotted projection paths + npcKnown / discovered helpers). `src/lib/narrator/{index.ts, template.ts}` (env-flagged factory + TemplateNarrator phrase bank keyed on (verb, band) with hardMove resolution from form template). `src/lib/narrator/prompts/{system.ts, slime.ts}` (Day 8 RemoteNarrator inputs authored now). 16 new tests; 115 total green. The negativeVocab eval-style test catches slime tone drift in the phrase bank itself. |
| 6 | done (2026-05-03) | Turn orchestrator (`src/lib/game/turn.ts`) wires sanitize → classify → roll → load projection → narrate → validate tools (atomic) → narration.emitted → match beats → cap-check → snapshot. Per-session seed cached from `session.started`. `src/lib/game/{classify, session, content}.ts` (regex classifier with synonym fallback; `createSession` helper; runtime content loaders for forms/locations/beats). `src/lib/util/{env, log}.ts` (zod-validated env + JSON-line logger). `src/lib/session/cookie.ts` (jose HS256, 30d TTL). `src/lib/db/client.ts` (HMR-safe singleton). API routes `/api/session` and `/api/turn`. 11 new tests (classify × 6, runTurn happy/cap/dead × 5); 126 total green (87 unit + 39 integration). |
| 7 | done (2026-05-03) | Minimal UI verified end-to-end against TemplateNarrator: landing → POST /api/session → /play → input → POST /api/turn → narration + projection update. Components: `Transcript`, `InputBox`, `VitalsBar` (cohesion / essence / turn / room / status). Death/cap screen + `begin again` restart. New `GET /api/state` returns projection + narration history. `tests/e2e/happy-path.spec.ts` (Playwright) authored. Eval scenarios 02-inventory-respect, 03-tool-selection, 04-tone-form, 05-refusal-impossible authored. **M1 milestone hit** — anonymous player completes a 10-turn slime run on the template narrator. |

## Next milestone — M2 (Week 2)

Goal: RemoteNarrator + episodic memory + 20 golden eval scenarios. Deploy to Fly.io. Tag `v0.1.0`.

| Day | Output |
|---|---|
| 8 | done (2026-05-03) | `src/lib/narrator/remote.ts`: RemoteNarrator using Sonnet 4.6 (per ADR / cost tier). Adaptive thinking implicit; system prompt + form card both wrapped in `cache_control: ephemeral` (5-min TTL). 16 hand-written tool definitions matching the Zod registry. Returns `{text, toolCalls}` for the orchestrator's `applyTools` to handle atomically. `narrator/index.ts` factory: lazy `require("./remote")` so the SDK doesn't load on the template path. eval/scenarios 06-prompt-injection, 07-partial-success-hard-move, 08-miss-not-noop authored. 8/20 scenarios. |
| 9 | done (2026-05-03) | `src/lib/game/classify-haiku.ts` (Haiku 4.5 free-text → verb whitelist via tool_choice; falls back to regex on confidence <0.5 or network error). `src/lib/game/tone.ts` (cheap-first: regex check for slime negativeVocab, then optional Haiku 4.5 1-shot judge with 1-5 score). `turn.ts` post-narration calls `checkToneFast` and logs warnings on violation (regen retry lands Day 12). Scenarios 09-entity-id, 10-npc-reintroduction, 11-memory-retrieval, 12-death-ends-session authored. 12/20 scenarios. |
| 10 | done (2026-05-03) | `src/lib/memory/episodic.ts`: voyage-3-lite (512-dim) `embedText` + `createMemory` + `retrieveMemories` (top-K via pgvector cosine `<=>`, then re-scored by `similarity * (1 + 0.3*entityOverlap) * exp(-ageMs/1h)`). `mockEmbedding` is a deterministic SHA-256-derived 512-dim unit vector — used when VOYAGE_API_KEY is unset, lets dev/tests run without burning credits. 10 new tests (mock determinism, magnitude, plumbing, exact-match retrieval, session scope, entity overlap). Scenarios 13-win, 14-cap, 15-tool-atomicity-rollback. 15/20 scenarios. |
| 11 | done (2026-05-03) | `turn.ts` calls `retrieveMemories(k=4)` before narrate; entity slugs are extracted from sanitized input vs `projection.npcs`. Top-k memories pass through to `NarrateInput.relevantMemories` (consumed by RemoteNarrator's user message). After successful tool batch, any `create_memory` calls land both as events AND as embedded rows in the `memories` table for next-turn retrieval. Scenarios 16-beat-fires, 17-beat-doesnt-fire, 18-input-sanitized authored. 18/20 scenarios. |
| 12 | done (2026-05-03) | Scenarios 19-time-passage + 20-absorb-mechanic authored — **20/20 scenarios complete.** `eval/judge.ts`: Sonnet 4.6 LLM-as-judge with tool_choice forcing 1-5 toneMatch + reason; gracefully no-ops if ANTHROPIC_API_KEY is unset. `eval/runner.ts` upgraded to drive end-to-end runTurn against TemplateNarrator: TRUNCATE per scenario, direct insert + appendEvents to honor scenario seed, assertion DSL covering `events`, `eventsAny`, `eventsAbsent`, `projection.<dotted>` with `>=N` / `<=N` numeric comparators. Markdown + per-scenario JSON report under `eval/runs/<timestamp>/`. **First full run: 10/10 template-runnable scenarios pass; 10 remote-only scenarios skipped (require ANTHROPIC_API_KEY)**. Top regressions fixed: 01 / 12 setup now uses full-kill damage + session.ended('death') for deterministic dead state on TemplateNarrator. |
| 13 | done (2026-05-03) | `play/page.tsx` adds a `Recap` panel that renders on session.ended (won/dead/capped) with verdict line + turn count + final room + final vitals + discovered rooms + xp + begin-again. `next.config.ts` marks `voyageai` and `@anthropic-ai/sdk` as `serverExternalPackages` (Turbopack can't resolve voyageai's extension-less internal imports; serverExternalPackages keeps the require/import server-side at runtime). `episodic.ts` lazy-imports voyageai inside `getVoyage()` for defense-in-depth. End-to-end verified in preview: 10 turns → capped → recap renders. Playwright fixture-based e2e against RemoteNarrator deferred (would require MSW + recorded fixtures; meaningful Day-14 follow-up). |
| 14 | done (2026-05-03) | `Dockerfile` (multi-stage Node 22 + Next 16 standalone output). `fly.toml` (Bombay region, shared-cpu-1x, deploy recipe in header comment). `next.config.ts` adds `output: "standalone"`. `docs/POSTMORTEM.md` reviews all 14 days, what shipped, what slipped, surprises, follow-ups. Tag `v0.1.0` pushed. The actual `fly deploy` awaits credentials; everything else for the deploy is committed. |

## Future milestones

- **M3 — Persistence**: Auth, save/resume, session summaries, world-state timeline shown to player.
- **M4 — Form #2 (Cursed Book)**: Validates the form-template architecture as a category. The wedge becomes demonstrable in a 30-second slime-vs-book same-seed clip.
- **M5 — Polish & deploy**: Status panel, quest log, inventory cards, dice animations, public deploy.

## Post-MVP — shipped since v0.1.0

Tracked here so we can see what's accumulated above the MVP line. See `docs/POST_MVP_PLAN.md` for the next 14-day plan.

| Date | Feature | Commit |
|---|---|---|
| 2026-05-03 | BYO LLM (per-user provider + model overrides) | `67888f0` |
| 2026-05-03 | Reliability hardening | `e30a86d` |
| 2026-05-03 | Per-user controls | `0baadcb` |
| 2026-05-03 | Forms expansion (slime / book / dragon-egg / dungeon-core / healer) | `8725008` |
| 2026-05-03 | World memory across runs | `59c6732` |
| 2026-05-03 | Streaming narration + leaderboard | `df73aa4` |
| 2026-05-03 | Abilities + per-campaign arcs | `172b760` |
| 2026-05-03 | Long Wyrm meta-arc | `51a5428` |
| 2026-05-03 | Reincarnation picker | `3b539d9` |
| 2026-05-03 | Live presence | `b501ac0` |
| 2026-05-03 | God-mode + safety guardrails | `3438da1` |
| 2026-05-03 | World lore ledger | `171e892` |
| 2026-05-03 | Inventory cap | `ce04257` |
| 2026-05-03 | Character page + cache | `197073f` |
| 2026-05-03 | Reincarnation batch 2 (50+ forms) | `20b0857` |
| 2026-05-03 | Real-time chat | `9d1f17f` |
| 2026-05-03 | Weekly themes | `b1c09e8` |
| 2026-05-03 | Lore admin + decay | `51bac34` |
| 2026-05-03 | Energy tiers | `578de92` |
| 2026-05-03 | Blessing of the Gods | `b7a3ddd` |
| 2026-05-03 | Daily-streak blessing (1→5 stack) | `4363b0b` |
| 2026-05-03 | Moderation + curses + power-creep ceilings | `1922be6` |

## Pre-Phase-1 polish (~14 dev days)

See `docs/POLISH_PLAN.md`. Foundation maturity work before Phase 1 begins:

- **0a** Commit + document local WIP (turn-lock + deployment infra + threat NPCs + speculative event batching)
- **0b** Operational maturity (turn-lock hardening, /api/ready split, Sentry observability, E2E smoke in CI, connection pooling)
- **0c** UI/UX polish (dice-roll animation, form-flavor accents, turn-in-flight surface, empty states + recap, onboarding nudges)
- **0d** Engagement quick wins (threat-NPC integration tests + content validation in CI, today's-runs ticker, session lobby with spectate)
- **0e** Cleanup sweep (scripts standardization, dead-code purge, doc accuracy pass)

After Phase 0 lands, Phase 1 of POST_MVP_PLAN begins on a hardened foundation.

## Post-MVP — next ~30 days

See `docs/POST_MVP_PLAN.md` for the full plan. High-level order:

**Days 1-14 — Persistence + thematic core + social fabric**
1. **Predicate engine** (Day 1-2) — shared infra for achievements, objectives, legacy-trait imprinting.
2. **Legacy traits** (Day 3) — death cause imprints on the user; next reincarnation starts with the scar.
3. **Achievements + titles** (Day 4-5) — ~40 catalogued, predicate-driven, leaderboard badges.
4. **Daily/weekly objectives** (Day 6) — compounds with the streak; energy rewards.
5. **Companion NPCs** (Day 7-8) — bonded NPCs follow you across reincarnations.
6. **Player gifting** (Day 9) — 1 gift/day, rate-limited, social glue.
7. **Run replay / share** (Day 10) — shareable transcript + OG image.
8. **Mood presets** (Day 11) — cozy / standard / brutal narration knob.
9. **Adaptive difficulty** (Day 12) — death streak → small +mod to subsequent rolls.
10. **World boss raids** (Day 13) — Long Wyrm gets HP; players collaboratively reduce it.
11. **Scene images** (Day 14) — opt-in, cost-gated visual moments.

**Days 15-17 — Engagement adds**
12. **Public world lore (24h delayed)** (Day 15) — `/lore` page; players see their influence after a satisfying delay.
13. **Foreshadowing memory plants** (Day 16) — echo memories surface 2-5 turns later as flavor hints.
14. **Wonder events** (Day 17) — 1%/turn random injections of "what was that?" narrative juice.

**Days 18-27 — Economy + crafting (central-bank phase)**
15. **Currency + NPC vendors** (Day 18-19) — coins, fixed-price catalogs as the price floor.
16. **Resource items + craft credits** (Day 20) — 0.1-energy/action via 0-9 credit counter.
17. **Gathering + location resources** (Day 21) — `gather_resource` tool; resource-tagged locations.
18. **Smelting + smithing + recipes** (Day 22) — full crafting toolset.
19. **Skills + XP + NPC trainers** (Day 23-24) — 7 skills; learn from a trainer NPC; level curve.
20. **Buy/sell loop end-to-end** (Day 25) — tutorial vendor + eval scenario.
21. **Economic balance + telemetry** (Day 26) — anti-farm caps, daily coin-flow rollup, admin dashboard.
22. **Skills/recipes UI + economy achievements** (Day 27).

**Days 28-37 — Engagement deepening**
23. **Famous deaths ticker** (Day 28) — memorable runs become public lore via the 24h-delay path.
24. **Reincarnation cooldowns** (Day 29) — same form locked for 24h after death; forces variety.
25. **Custom epitaphs** (Day 30) — last-words on death become location-tied lore.
26. **Custom item naming** (Day 31) — `rename_inventory` tool; narrator picks up the rename.
27. **Player notes in locations** (Day 32-33) — Dark Souls-style asynchronous one-liners.
28. **Named antagonist (Rhozell)** (Day 34-35) — recurring villain with cross-run grudge memory.
29. **First-10-minutes tutorial** (Day 36-37) — scripted slime intro for brand-new players.

**Days 38-62 — Phase 7: 365-day campaign + reliability**
30. **Calendar engine + per-user cost ceilings** (Day 38) — `world_calendar` + chapter cron + tiered AI-spend caps.
31. **Chapter prompt-fragment** (Day 39) — narrator picks up active chapter tone.
32. **Provider redundancy** (Day 40-41) — multi-provider failover (Anthropic → Bedrock → Vertex → Template).
33. **Faction state** (Day 42-43) — 4 factions, `pledge_faction`, contribution rollups.
34. **Branch decision tracking** (Day 44) — 10 major branches resolve into persistent canon.
35. **Recurring NPC engine** (Day 45-46) — chapter-gated rotation, cross-run history weighting.
36. **Wyrm raid → Branch V wiring** (Day 47-48) — aggregate damage drives mid-year arc compression.
37. **Three Votes** (Day 49) — Books XI-XII vote tallies + resolution.
38. **Endings machinery** (Day 50) — 6 endings + Year 2 seed.
39. **First-to-Sit + Edicts** (Day 51) — Hollow Throne quest + player-note → law promotion.
40. **Scheduled world events** (Day 52) — synchronized injections like the Wyrm Voice.
41. **Story authoring tooling** (Day 53) — CLI scaffolder + validator + eval scenario 22.
42. **Sandbox preview env** (Day 54-56) — staging app with `STORY_TIME_FACTOR<1` for chapter QA.
43. **Story admin dashboard** (Day 57) — `/god/story` for live ops.
44. **Catch-Up Codex** (Day 58) — per-chapter auto-summaries + mid-year onboarding flow.
45. **Lapsed/returning player flows** (Day 59-61) — re-engagement emails + welcome-back surface + streak grace.
46. **Year Archive** (Day 62) — end-of-year snapshot + permanent `/world/year/[n]` pages + Year 2 seed loader.

**Days 63-72 — Phase 8: launch-ready operations**
47. **Analytics & metrics dashboard** (Day 63) — DAU, retention, run completion, faction balance, $/DAU.
48. **Backup + replay-from-zero CI** (Day 64) — nightly backup + CI replay validation.
49. **Load testing** (Day 65-66) — k6 scripts + pgvector IVF index tuning.
50. **Mobile UX pass** (Day 67) — responsive audit + touch targets.
51. **Email infrastructure** (Day 68) — Resend + templates + unsubscribe.
52. **Payment integration** (Day 69-71) — Stripe Checkout + tier upgrades + dunning.
53. **GDPR + Sentry + a11y** (Day 72) — data export/delete + error tracking + accessibility audit.

**Days 73+ — Bigger swings**
54. **NPC dialogue system** (Day 73+) — multi-turn conversations with personality continuity (3-5d).
55. **Player-authored forms** (Day 78+) — submission queue + admin approval (5-7d).
56. **Player-driven marketplace** (Day 85+) — Phase 6a: P2P listings, gated by Phase 5 telemetry (~7d).
57. **Ascension** (Day 85+, parallel) — Phase 6b: endgame meta-forms unlocked after ~50 runs (~7-10d).

**Month 3+ — Phase 9: post-launch deepening (~30d total, sequenced by need)**
58. **Localization scaffolding** (~3d) — `messages/en.json` + first second-locale (Spanish).
59. **Voice TTS for NPC moments** (~3d) — ElevenLabs for Wyrm Voice, antagonists, Counsel.
60. **PvP duels** (~5d) — opt-in cross-faction encounters via 2d6 system.
61. **Guilds / parties** (~5d) — sub-faction groups with own chat + objectives.
62. **Form-specific dice variants** (~2d) — 2d6 / 3d4-keep-highest / re-roll mechanics per form.
63. **Player-as-NPC retirement** (~2d) — ascended/permadied veterans become recurring NPCs.
64. **In-run companions** (~3-4d) — bonded NPCs actively join the current run; can level + die.
65. **Party play (2-3 players)** (~7-10d) — round-robin lockstep co-play; tier-gated (patron hosts).

**Ongoing**
- Weekly chapter authoring (~2-4h/week, 4-chapter buffer).
- Year 2+ shape sketch (~Day 150 of live play).
- Sub-faction politics (8-12 pieces during Books V-VIII).
- Recurring-NPC tier-2 cast (1-2/week, target +20).
- Form polish pass (1 form/week).

**World clock**: locked at 1:1 real time (ADR-019). 1 chapter = 7 real days UTC. 1 Year = 365 real days. Phases 7+8 combined are ~35 dev days; they power a 365-real-day story.

See `docs/STORY_BIBLE.md` for the full 48-chapter outline, faction details, branch decisions, and endings.

## Post-MVP growth bets (month 2+)

1. Ship form #2 (Cursed Book) at depth and form #3 (Dungeon Core).
2. Daily-rotation + shared-seed loop (Wordle-style ritual; persistent-world legacy as Spelunky-style underlay).
3. Record and post slime-vs-book same-seed clip to r/aigamedev.

See `docs/PLAN.md` for the original 14-day MVP plan, `docs/POST_MVP_PLAN.md` for the next-14-day plan, and `docs/BRIEF.md` for the original brief.
