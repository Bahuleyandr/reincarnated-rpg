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
| 6 | **in progress (2026-05-03)** | Turn orchestrator: classify (regex) → roll → memory (stub) → narrate → validate → append → project. API routes `/api/session`, `/api/turn`. Signed cookie session. |
| 7 | pending | Minimal UI (`play/page.tsx`, Transcript, InputBox, VitalsBar). Death screen + restart. Playwright happy-path. **Author scenarios 1–5.** M1 milestone hit. |

## Next milestone — M2 (Week 2)

Goal: RemoteNarrator + episodic memory + 20 golden eval scenarios. Deploy to Fly.io. Tag `v0.1.0`.

| Day | Output |
|---|---|
| 8 | RemoteNarrator (Anthropic SDK, Sonnet 4.6, tool-calling, prompt caching). Env flag `NARRATOR=remote\|template`. Author scenarios 6–8. |
| 9 | Classifier upgrade to Haiku 4.5 free-text → verb whitelist. Per-turn tone classifier (drift detector). Author scenarios 9–12. |
| 10 | Episodic memory: `memory/episodic.ts` — voyage-3-lite embed, pgvector kNN. Retrieval: similarity × entity-overlap × recency. Author scenarios 13–15. |
| 11 | Wire memories into `NarrateInput`. Tune retrieval. NPC reintroduction test. Author scenarios 16–18. |
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
