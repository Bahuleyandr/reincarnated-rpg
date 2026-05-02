# Decisions log (ADR-style)

Each decision: what was decided, why, and when. Append-only.

## ADR-001 — Stack: Next.js 16 App Router + Drizzle + Postgres + pgvector

**Date:** 2026-05-02. **Status:** locked.

Original brief specified Next.js 15. `create-next-app@latest` shipped Next 16 (released after the brief was authored). Net effect: same App Router model, breaking changes flagged in `AGENTS.md`. Drizzle chosen over Prisma for this project (VH Health uses Prisma) because pgvector ergonomics + lower runtime overhead favor Drizzle here.

## ADR-002 — Deploy: Fly.io (not Vercel)

**Date:** 2026-05-02. **Status:** locked.

Reasons:
- Persistent processes available for future Inngest worker.
- No function-timeout cap on slow narration calls (>10s common).
- Fly Postgres can colocate; Neon serves as alternate prod DB with branchable evals.

## ADR-003 — Embedding model: voyage-3-lite (512-dim)

**Date:** 2026-05-02. **Status:** locked.

8x cheaper than OpenAI `text-embedding-3-small`. Retrieval quality competitive at MVP scale. Schema column: `vector(512)`. Swap point: behind the `memory/episodic.ts` interface.

## ADR-004 — Projection: snapshot + delta

**Date:** 2026-05-02. **Status:** locked.

Write `projections` row after every successful turn. Read path: load snapshot, replay events with `seq > up_to_seq`. Cold reads / schema bumps replay from zero. Snapshots are a cache, not the source of truth — replay-from-zero must always work.

## ADR-005 — Postgres host: Docker dev / Neon prod

**Date:** 2026-05-02. **Status:** locked.

Local dev via `docker-compose` (port 5433 — avoids clashing with VH Health's 5432). Prod: Neon free tier. Branchable for evals against forked DB without polluting prod data.

## ADR-006 — Cookie signing: jose HS256, 32-byte SESSION_SECRET

**Date:** 2026-05-02. **Status:** locked.

Standard, zero infra. Rotation: `SESSION_SECRET_PREVIOUS` for verify-only during cutover.

## ADR-007 — Content license: CC BY-NC 4.0

**Date:** 2026-05-02. **Status:** locked.

Game content under `content/` (forms, locations, beats, NPCs) licensed CC BY-NC 4.0 attributed to user. Blocks third-party clones; preserves commercial path. Source code license: MIT (TBD, set before public).

## ADR-008 — First form: Lesser Slime + full anti-drift scaffolding

**Date:** 2026-05-02. **Status:** locked.

Honoring brief. Slime stays form #1. Mitigation for tone-drift risk:
1. Negative vocabulary list (see `docs/MECHANICS.md`) re-emitted in every system prompt.
2. Five hand-authored second-person slime-POV passages embedded as one-shot exemplars (`content/forms/lesser-slime.json` → `sampleCorpus`).
3. Hard-move menu of 8 form-specific moves; partial-success rolls MUST pick from menu (`hardMoves`).

## ADR-009 — Form #2 timing: M4 (post-launch)

**Date:** 2026-05-02. **Status:** locked.

Cursed Book ships in M4, not v0.1. Keeps 2-week MVP target intact. Wedge ("every form is a different game") becomes demonstrable in a 30-sec same-seed clip after M4 — that clip is the launch demo for r/aigamedev.

## ADR-010 — Eval scenario count: 20

**Date:** 2026-05-02. **Status:** locked.

User-chosen. Authored across days 7–12 (5 against TemplateNarrator on day 7; remainder against RemoteNarrator). Coverage matrix in `docs/EVAL.md`.

## ADR-011 — Tool atomicity: all-or-nothing per response

**Date:** 2026-05-02. **Status:** locked.

If any tool in a model response fails validation: rollback batch, emit `tool_validation_failed`, re-prompt with error (max 1 retry), fall back to `narrate_only`. Single biggest defense against canon drift after entity-ID discipline.

## ADR-012 — Tool list: 17 tools (brief had 11)

**Date:** 2026-05-02. **Status:** locked.

Added per critique:
- `change_form_state` (slime's analog to HP isn't HP)
- `pass_time` (beats end on tick boundaries)
- `sense` (slime perceives via vibration/chemistry/thermal, not vision)
- `absorb` (slime's signature, distinct from inventory)
- `narrate_only` (explicit no-op; prevents spurious tool calls for compliance)

Full union in `src/lib/game/types.ts` (M1 day 4).

## ADR-013 — Default narrator: TemplateNarrator until M2 day 8

**Date:** 2026-05-03. **Status:** locked.

Env flag `NARRATOR=template|remote`. Default `template` keeps M1 deterministic, no API costs in dev/test. Switch to `remote` (Anthropic) on day 8.

## ADR-014 — Project name: reincarnated-rpg (kebab-case)

**Date:** 2026-05-03. **Status:** locked.

Original plan used `Reincarnated`. npm rejected capitals. Switched to `reincarnated-rpg` matching VH Health monorepo kebab-case convention. Project root: `C:\Dev\Projects\reincarnated-rpg\`.
