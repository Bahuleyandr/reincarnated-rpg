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

## ADR-015 — Energy tiers: free / supporter / patron, continuous regen

**Date:** 2026-05-03. **Status:** locked.

Each turn costs 1 energy. Tiers vary by `max` cap and `regenIntervalMs`:
- Free: 20 cap, 45-min regen (~32 turns/day).
- Supporter: 60 cap, 20-min regen (~72 turns/day).
- Patron: 120 cap, 10-min regen (~144 turns/day; effectively unlimited for normal play).

Regen model: `ticks = floor((now - lastUpdated) / regenInterval)`, advance `lastUpdated` only by ticks awarded so partial intervals carry forward (no stash loss). When at max, fast-forward `lastUpdated` to now so the next spend still waits a full interval — prevents accumulation while idle.

Race condition (read→compute→write) accepted: at most one extra turn per concurrent burst, cost negligible. A future Postgres advisory-lock variant could harden if needed.

Tier promotion: admin-only for v1 (no payment integration). `/god/energy` is the path. Tier catalog is data — adding/changing tiers is a content-only commit.

## ADR-016 — Blessing of the Gods: pure-function 7-day buff for free tier

**Date:** 2026-05-03. **Status:** locked.

Free-tier players within 7 days of account creation (or anon-session start) get cap × 2 (20 → 40) and regen / 2.25 (45min → 20min). Net: blessed-free ≈ supporter tier.

Pure function (`effectiveTier`), not stored anywhere. Computed from `users.createdAt` or `sessions.startedAt` on every read. Paid tiers don't get the blessing (they don't need the lure).

Why pure: lures the player without locking us into a stored expiry that needs cron invalidation. Day 8: blessing simply stops applying — no migration, no event, no edge case where a blessed user gets stuck buffed.

## ADR-017 — Daily streak: UTC-day-based, 1-5 stack, +N energy on first turn

**Date:** 2026-05-03. **Status:** locked.

First turn (or page load) on a new UTC day grants `streakAfter` energy (1 → 2 → 3 → 4 → 5, capped at MAX_STREAK=5). Missed day resets to 1. Five-day climb: 1+2+3+4+5 = 15 bonus energy.

UTC-day chosen over local time: less code, no timezone drama, lines up with meta-arc and lore-decay clocks. Also: a "world calendar" feels right for a persistent shared world.

Grant CAN exceed tier max temporarily — it's a one-shot gift; regen still won't tick until energy drops below max via spending. Same rule applies to player-to-player gifting (planned).

Idempotent within a day: `lastDayUtc === today` short-circuits to no-op. Both `getEnergyView` AND `trySpend` claim — page load counts as "logging in", not just turn-taking. Pure module (`lib/energy/streak.ts`); persistence on `users.streak_count` + `users.streak_last_day_utc` (and same on `sessions.*` for anon).

## ADR-018 — Moderation, curses, and power-creep ceilings

**Date:** 2026-05-03. **Status:** locked.

Three input gates run in order before each turn:

1. **Prompt injection** (regex patterns in `lib/moderation/injection.ts`): rejected with 400 BEFORE `trySpend` so attackers can't drain energy via spam. The system prompt + delimited `<player_input>` wrap is the real defense; this is a cheap outer gate.
2. **Severe profanity** (slurs, sexual-violence language, "kys"): energy IS charged, `runTurn` short-circuits with a refusal narration + `+5 bad_luck` stack. No classify, no roll, no narrator call.
3. **Mild profanity** (everyday cussing): turn proceeds normally + `+2 bad_luck` stack queues for the next 2 turns.

Bad-luck mechanic: `form_state.bad_luck` accumulates via `change_form_state` events. Roll modifier penalty `−min(2, floor(badLuck))` so curses sting but don't make success impossible. Decays −1 per turn (skip when at 0); cap at `BAD_LUCK_MAX=20` so a griefing player can't stack themselves to oblivion in a single session.

Power-creep ceilings (`SAFETY_CAPS` in `lib/game/tools.ts`):
- `maxToolsPerTurn = 6` — `applyTools` rejects bursts beyond this with `tool_validation_failed`, which the existing retry loop converts to a re-prompt asking the narrator to consolidate.
- `grant_xp.amount` zod cap dropped 999 → 50 per call. Multiple calls per turn still stack but no single call levels the player into orbit.
- `formStateAbsMax = 20` (existing) — applies to bad_luck too, since it rides through `change_form_state`.

Why severe-profanity charges energy: the in-fiction tax is the punishment. Refunding would invite spam. Why injection doesn't: nothing happened in-fiction; the engine never even classified.
