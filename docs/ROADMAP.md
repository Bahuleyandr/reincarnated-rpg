# Roadmap

Source of truth for what is in-flight and what is next. Update as days complete.

## Current milestone — M1 (Week 1)

Goal: TemplateNarrator playable end-to-end (no AI). Anonymous player completes a 10-turn slime run with deterministic phrase-bank narration.

| Day | Status | Output |
|---|---|---|
| 1 | **in progress (2026-05-03)** | Repo init, deps installed, configs/docs/CLAUDE/README authored, `content/forms/lesser-slime.json` authored in full (negative vocab + hard-move menu + sample corpus), private GitHub repo created. Baseline commit. |
| 2 | pending | Drizzle schema (10 tables), migrations applied locally, `scripts/seed.ts`, `content/locations/collapsed-tunnel.json`. Schema round-trip unit test. |
| 3 | pending | Event log: `events.ts` append/readLog with seq guards. `projection.ts` reducer + snapshot writer. ≥10 reducer unit tests. Postgres rule blocks DELETE/UPDATE on events. |
| 4 | pending | Rules engine: `rules.ts` 2d6 + modifier + bands, seeded PRNG. Tool registry + Zod validators + atomicity wrapper. `sanitize.ts`. Eval harness skeleton. |
| 5 | pending | TemplateNarrator phrase-bank. Beat matcher. Author 5 beats × roll outcomes for "survive the night". Beat unit tests. |
| 6 | pending | Turn orchestrator: classify (regex) → roll → memory (stub) → narrate → validate → append → project. API routes `/api/session`, `/api/turn`. Signed cookie session. |
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
