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

## ADR-020 — Turn-lock semantics: pessimistic per-session token + expiry

**Date:** 2026-05-04. **Status:** locked (initial scope) / iterating (Phase 0b.1 hardens this).

Concurrent turn requests for the same session race on the event log: two simultaneous POSTs to `/api/turn` could both append `turn.begun` for the same turn number. The cheapest, most legible defense is a per-session lock with a token + expiry, written via a guarded UPDATE. Rejected alternatives:
- *Postgres advisory locks* — keyed on session UUID hash. Cleaner cleanup semantics, but the lock state is invisible to other queries (no admin view, no audit). The token-on-row pattern lets us inspect locks via SQL, force-release stuck ones from `/god`, and audit the history.
- *Row-level `FOR UPDATE`* — too coarse: holds a transaction across the full turn (~5-30s including LLM call). With pgbouncer in transaction-pool mode it'd starve the pool.
- *Optimistic concurrency on `up_to_seq`* — fights symptoms, not the cause. Two writers both see seq=N, both try to write seq=N+1, one fails. Acceptable for state but the *narration* still ran twice — wasted Anthropic spend.

**Schema** (`0020_session_turn_locks.sql`): `sessions.turn_lock_token text` + `sessions.turn_lock_expires_at timestamptz`, indexed on the expiry. Lock acquisition: `UPDATE sessions SET turn_lock_token = $newToken, turn_lock_expires_at = $now + 30s WHERE id = $sessionId AND (turn_lock_token IS NULL OR turn_lock_expires_at < $now)`. Returns the new token if affected; null otherwise.

**Lock duration**: 30 seconds. Long enough for the typical 5-10s narrator + tools turn; short enough that an orphaned lock self-heals quickly.

**Open work (Phase 0b.1)**: try/finally cleanup on all error paths, separate audit-log table for lock events (acquired / released / expired / force_released), an admin force-release UI at `/god/locks`, and a cron cleaner that releases locks past their expiry by a 5-minute margin.

## ADR-021 — Deployment target: Fly.io single VM (Bombay) for v0.x

**Date:** 2026-05-04. **Status:** locked for v0.x; revisit at v1.

Production runs on a single shared-cpu-1x Fly.io VM in Bombay (`bom`). Persistent process model fits us: the SSE narrator stream + the future world-event scheduler + the chapter-advance cron all benefit from a single long-running process over a serverless one. Fly.io specifically (not AWS / GCP) because:

- Latency for the South Asian user base is meaningfully lower from `bom` than from `iad` / `cdg`.
- One-command `fly deploy` keeps deploy ergonomics simple at this stage.
- Postgres is *separate* (Neon, EU-hosted). We pay one cross-region hop for DB; in exchange the DB is branchable + free for v0.x.
- Single-region acceptable: 99% uptime is fine for v0.x; multi-region adds infra complexity (read replicas, sticky sessions) that doesn't pay off until we have a global player base.

**Health probes**: `/api/health` (liveness, cheap) for keep-alive at 30s intervals; `/api/ready` (planned in Phase 0b.2) for the deploy gate.

**Auto-scaling**: `min_machines_running = 0` so we can sleep entirely between players. Soft scale at 50 concurrent requests, hard cap at 100. Cold-start adds ~2s to first request after idle — acceptable.

**Revisit triggers**: latency complaints from non-IN players (would justify multi-region), sustained > 100 concurrent (justifies a bigger VM), persistent OOM (bigger VM or memory-cap profiling).

## ADR-019 — World clock runs at 1:1 real-world time

**Date:** 2026-05-04. **Status:** locked.

The world's calendar advances at real wall-clock pace. Every existing time-based system already runs at 1:1 (energy regen, streak UTC-day, daily/weekly objectives, 24h-delayed lore, reincarnation cooldowns, blessing window, weekly themes), so this ADR makes that consistent across the *story* layer too:

- **1 chapter = 7 real days** (UTC midnight Sunday → Sunday rollover).
- **1 Book = 4 chapters = ~30 real days.**
- **1 Year = 12 Books = 365 real days** (52 weeks; the extra day lands in Book XII as denouement padding).
- **Branch decisions resolve at chapter-end UTC midnight.** Aggregate metrics frozen at that instant.
- **End-of-year Votes** (Books XI-XII) tally over the full chapter window — a real week per vote.
- **Scheduled world events** fire at fixed UTC moments (e.g. Wyrm Voice = Day 165 12:00 UTC).
- **Admin pause** is the only way to halt the clock — used for incidents, NEVER for content slips. Time accelerated only in the staging/preview environment.

**Why locked**:
- *Persistence is the wedge.* "The world remembers what you did" is hollow if the world can be fast-forwarded. Real time is what makes the persistence real.
- *Compounds with everything we've built.* Every other clock is already real-time; the story clock should match.
- *Anti-burnout structurally.* A binge player can't outrun the world. Cadence is enforced at the wall, not at the player's wallet.
- *Cheaper to operate.* No replay infrastructure for live state — every player at moment T sees the same chapter.
- *Aligns with successful precedents.* Animal Crossing, Habitica, persistent MMORPGs — all run at 1:1 because that's what makes a "lived-in" world feel lived-in.

**Costs we accept**:
- *Mid-year entry is harder.* Mitigated by the Catch-Up Codex (auto-generated condensed lore briefing for any player joining after Book I Ch 1).
- *Bad balance lasts a real week.* Mitigated by the Day 52 admin dashboard which can hot-patch chapter content.
- *Failure-engagement → Long Sleep ending.* Built in as a real ending, not a degenerate state.
- *Testing is harder.* Mitigated by `STORY_TIME_FACTOR` env var: in staging, 1 chapter = 1 hour. Production hard-codes 7 days.
- *A "missed" event is gone for that year.* This is intentional — scarcity gives moments their weight. Year 2 archive lets people read what they missed afterward.

**Pause semantics**: when admin pauses the calendar (`/god/story` toggle), `chapter_started_at` is replayed forward by the pause duration on resume so chapter length stays exactly 7 days of *active* time. Pauses are logged in `world_events` with kind `calendar.paused` / `calendar.resumed` for audit.

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
