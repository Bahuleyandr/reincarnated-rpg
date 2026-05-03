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
| 12 | Author scenarios 19–20. `eval/judge.ts` LLM-as-judge rubric. Run all 20. Fix top 3 regressions. |
| 13 | UI polish: vitals bar, death screen, recap. Playwright e2e against RemoteNarrator with recorded fixtures. |
| 14 | Deploy to Fly.io. Neon Postgres + pgvector. Smoke test. Tag `v0.1.0`. Write `docs/POSTMORTEM.md`. |

## Future milestones

- **M3 — Persistence**: Auth, save/resume, session summaries, world-state timeline shown to player.
- **M4 — Form #2 (Cursed Book)**: Validates the form-template architecture as a category. The wedge becomes demonstrable in a 30-second slime-vs-book same-seed clip.
- **M5 — Polish & deploy**: Status panel, quest log, inventory cards, dice animations, public deploy.

## Post-MVP growth bets (month 1 after v0.1)

1. Ship form #2 (Cursed Book) and form #3 (Dungeon Core).
2. Daily-rotation + shared-seed loop (Wordle-style ritual; persistent-world legacy as Spelunky-style underlay).
3. Record and post slime-vs-book same-seed clip to r/aigamedev.

See `docs/PLAN.md` for full plan and `docs/BRIEF.md` for original brief.
