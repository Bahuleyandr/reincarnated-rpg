# Polish Plan — foundation maturity before Phase 1

**Status**: 10/14 sub-phases shipped 2026-05-04 (commits `4a0d01a` through `263ef60`). **Pre-Phase-1 work.** Read before starting `POST_MVP_PLAN.md` Phase 1 (predicate engine).

## Progress

| Sub-phase | Status | Output |
|---|---|---|
| 0a — commit local WIP + ADRs | **shipped** | 4 logical commits + ADR-020 (turn-lock) + ADR-021 (Fly.io) |
| 0b.1 — turn-lock hardening | **shipped** | audit log table, force-release, getActiveLocks, /god/locks API, Date-serialization bug fix, 9 integration tests |
| 0b.2 — health/ready split | **shipped** | /api/health (liveness, +commit/version) and /api/ready (DB + pgvector + content + Anthropic checks); fly.toml dual probes |
| 0b.3 — Sentry + structured metrics | *deferred* | requires SDK install + Next instrumentation + env config; queue for next session |
| 0b.4 — E2E smoke in CI | *deferred* | requires Playwright config + new spec + GH workflow change |
| 0b.5 — connection pooling | **shipped** | DATABASE_URL_DIRECT for migrations + pooled DATABASE_URL for app + DATABASE_POOL_MAX env (default 10) |
| 0c.1 — dice-roll animation | **shipped** | tumble through random faces ~900ms before settling; reduced-motion respected |
| 0c.2 — form-flavor accents | *deferred* | touches every component + content schema; fits better as a focused day after Phase 1 |
| 0c.3 — turn-in-flight UI | **shipped** | 409 returns currentLockExpiresAtMs; InputBox shows "settling…" + auto-retries |
| 0c.4 — empty states + recap polish | **shipped** | death/win/cap scrim, tone-aware verdict, view-character link |
| 0c.5 — onboarding nudges | *deferred* | depends on Phase 1 predicate engine; revisit then |
| 0d.1 — threat-NPC pin tests | **shipped** | 8 unit tests pinning the 4 threat NPCs (existence, displayName, validation pass) |
| 0d.2 — today's-runs ticker | **shipped** | /api/world/today + auto-rotating marquee on the homepage; in-character empty state |
| 0d.3 — session lobby + spectate | *deferred* | requires presence integration + opt-out flag + spectator API |
| 0e — cleanup sweep | **partial** | ARCHITECTURE.md accuracy pass; scripts standardization + dead-code sweep deferred |

## What this means for Phase 1

The hardened foundation is in place: turn-lock with audit, ready probe, connection pooling, speculative event batching. Phase 1 (predicate engine) opens on a stable platform.

The 5 deferred items below are real but not blocking. Pick them up opportunistically:
- **0b.3 Sentry** — schedule before public launch.
- **0b.4 E2E smoke** — add when first E2E regression embarrasses us.
- **0c.2 form-flavor** — fits naturally after Phase 1 day 3 (legacy traits) lands form-aware UI work.
- **0c.5 onboarding nudges** — sits on top of the Phase 1 predicate engine; do as a Phase 1 follow-up.
- **0d.3 session lobby** — needs the spectator API spec from Phase 2 day 10 (run replay) anyway.

---

The repo has accumulated substantial uncommitted local work that the long-term plan doesn't account for: a turn-lock + safety layer, deployment infrastructure (Dockerfile / fly.toml / GitHub Actions / migration + smoke scripts), a `/api/health` endpoint, four threat-themed NPC templates, and a refactor of the turn loop toward speculative event batching. This is good — it's mostly the operational foundation Phase 8 was going to build anyway, just landed early. But it left rough edges.

This plan covers the ~14 dev-days of polish that should land **before** we start Phase 1 of the long-term plan, so that the foundation is solid and the next features compound cleanly.

## Premise

The shipped game (master at `b5bc8e9`) is playable end-to-end with energy / streaks / moderation / curses. The uncommitted local work adds:

- **Turn-lock + safety modules** — concurrency-safety primitive (sessions get a token + expiry; only one in-flight turn per session). Migration `0020_session_turn_locks.sql`.
- **Speculative event batching** — `runTurn` now builds events in-memory (`pendingEvents`) and validates against a speculative projection before any DB write. `validateToolsToEvents` decouples validation from persistence.
- **Centralized safety caps** — moved into `src/lib/game/safety.ts` (was inlined in `tools.ts`). All tool zod schemas now reference the constant object.
- **Deployment infra** — multi-stage Dockerfile, `fly.toml` (Bombay region, `/api/health` probe), GH Actions CI workflow (Postgres+pgvector inline), `migrate-prod.mjs`, `seed-runtime.mjs`, `smoke.mjs`, `validate-content.ts`, `check-test-db.ts`.
- **Minimal `/api/health` endpoint** — returns `{ status: "ok", time }` only.
- **Four threat-themed NPC templates** (`ambient-threat`, `patrol-presence`, `warped-minion`, `wrong-reader`) — wired into form-specific hard-moves.
- **Two new tests** (`tests/unit/remote-narrator.test.ts`, `tests/unit/tool-validation.test.ts`).

The rough edges:

1. **Turn-lock**: server-clock-based expiry only (no skew protection); coarse-grained (per-session, no row-level lock); release path doesn't strictly verify the token holder; no automatic cleanup on error paths.
2. **Health endpoint**: no DB ping, no embeddings reachability check, no content-loaded validation. A misconfigured deploy passes the probe.
3. **CI**: only unit + integration; no E2E smoke; no automated rollback on deploy failure; no observability hooks.
4. **Connection pooling**: not configured. `postgres-js` clients without limits will blow the Neon free tier's connection cap under any load.
5. **Threat NPCs**: authored but no test confirms they actually fire from the corresponding hard-moves at runtime.
6. **Scripts**: mix of `.ts` (`tsx`-run) and `.mjs` (Node-run) — pick one.
7. **README** doesn't describe the deployment path (Docker, Fly, migrate-prod) accurately.
8. **No /metrics endpoint** — Phase 8 Day 63 wants this; we should stub it now while we're touching `/api/health`.
9. **UI feel**: minimal. No dice animation, no form-flavor accents, no loading state when a turn-lock is held, sparse empty states.
10. **Engagement signals**: streak count buried in the EnergyBar; no homepage "today's runs" ticker; no surface for joining other players.

## Day plan

| Day | Output |
|---|---|
| **0a** | commit + document the local work; update README + DECISIONS |
| **0b.1** | turn-lock hardening (heartbeat + try/finally cleanup + audit logging) |
| **0b.2** | health endpoint depth (split `/api/health` and `/api/ready`; DB + embeddings + content checks) |
| **0b.3** | observability (Sentry + structured turn-event logging + cost telemetry) |
| **0b.4** | E2E smoke in CI (POST a turn against staging, assert event log) |
| **0b.5** | connection pooling + Neon pooler URL + per-env settings |
| **0c.1** | dice-roll animation on `roll.resolved` events |
| **0c.2** | form-flavor accents (per-form CSS variables for color + typography) |
| **0c.3** | turn-in-flight UI (lock state surfaced; disabled input + spinner) |
| **0c.4** | empty states + recap polish (death scrim, win celebration, dice reveal) |
| **0c.5** | onboarding nudges (3 contextual hints in first 5 turns of a fresh session) |
| **0d.1** | threat-NPC integration tests + content validation in CI |
| **0d.2** | today's-runs ticker + streak nav surface |
| **0d.3** | session-lobby surface (see who's playing now, what form, what location) |
| **0e** | cleanup sweep (scripts standardization, dead code, doc accuracy) |

Total: **14 dev days** before Phase 1 of `POST_MVP_PLAN.md` begins.

---

## Phase 0a — Commit + document the local work (Day 0a, ~0.5d)

**Why**: 30+ uncommitted files is technical debt accumulating. Lock the current state before building on it.

**Work**
- Split the local diff into 3 logical commits:
  1. **Deployment infra** — `.github/`, Dockerfile, fly.toml, scripts/{migrate-prod,seed-runtime,smoke,validate-content,check-test-db}, `/api/health`, eslint config tweak, README updates, LICENSE.
  2. **Turn-lock + speculative event batching** — migration 0020, `turn-lock.ts`, `safety.ts`, refactored `turn.ts`, refactored `tools.ts`, refactored `narrator/remote.ts` (zod refs), test additions for tool validation.
  3. **Threat NPC content** — 4 NPC JSON files + any narrator/template wiring that surfaces them.
- Each commit has a tight commit message documenting the *why* + *what*.
- Add 2 new ADRs to `DECISIONS.md`:
  - **ADR-020**: Turn-lock semantics (pessimistic per-session token + expiry, not row-level; rationale + tradeoffs).
  - **ADR-021**: Deployment target — Fly.io Bombay region single VM for v0.x; multi-region post-launch.
- Update `README.md`:
  - "Run locally" section accurate against current scripts.
  - "Deploy to Fly" section with `fly deploy` recipe.
  - "How CI works" pointing to `.github/workflows/ci.yml`.
  - Architecture diagram updated to show turn-lock layer.

**Acceptance**: Working tree clean. `master` at HEAD reflects the local work. README is accurate. New ADRs land in `DECISIONS.md`.

---

## Phase 0b — Operational maturity (Day 0b.1 - 0b.5, ~5d)

### Day 0b.1: Turn-lock hardening

**Why**: Current implementation has three holes: server-clock dependency, no error-path cleanup, no audit trail.

**Schema migration `0021_turn_lock_audit.sql`**
```sql
CREATE TABLE turn_lock_events (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_kind text NOT NULL,        -- 'acquired' | 'released' | 'expired' | 'force_released'
  token text,
  at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX turn_lock_events_session_idx ON turn_lock_events (session_id, at DESC);
```

**Files**
- `src/lib/game/turn-lock.ts` (modify): wrap acquire/release in `try { ... } finally { release }` patterns; require token-match on release (strict equality, not just nullify); emit `turn_lock_events` rows on every state change for forensic auditing.
- `src/lib/game/turn.ts` (modify): all four turn entry points (POST `/api/turn`, POST `/api/turn/stream`, eval runner, future companion sub-turn) wrap the full turn body in a try/finally that releases the lock — on success, on error, on timeout, on early return.
- `src/app/god/locks/page.tsx`: admin view of currently-held locks (token, holder session, expires_at, age) with force-release button.
- New cron (every minute): scan for locks `expires_at < now() - interval '5 minutes'` (i.e. orphaned locks past their expiry by a comfortable margin) and force-release them with `force_released` audit row.

**Acceptance**: Crash mid-turn → lock auto-released within 5min. Replay attack with stale token → release rejected. Admin can see + clear any stuck lock at `/god/locks`.

**Gotchas**
- Don't release a lock you don't hold. The token comparison is the only guard against a delayed worker releasing a fresh lock.
- The 5min orphan threshold is bigger than the 30s turn-lock expiry on purpose — gives a real turn time to complete (with retries) before the cleaner moves in.

### Day 0b.2: Health endpoint depth + readiness split

**Why**: A misconfigured deploy with a missing DB password currently passes `/api/health`. Need real readiness checks.

**Files**
- `src/app/api/health/route.ts` (modify): keep as a *liveness* probe — process is up, no expensive checks. Returns `{ status: "ok", time, version, commit }`. Includes `commit` from a build-time env var so deployments are auditable.
- `src/app/api/ready/route.ts` (NEW): *readiness* probe. Pings DB (`SELECT 1`), checks pgvector extension is loaded, validates content directory has at least 1 form + 1 location, checks Anthropic API key is reachable (HEAD request to `/v1/messages` with no body — should 400, not 401). Returns 503 if any check fails with the specific failure reason. 5s timeout total.
- `fly.toml` (modify): change health check from `/api/health` to `/api/ready` for the deploy gate; keep `/api/health` for the keep-alive probe.

**Acceptance**: Wrong DATABASE_URL on a fresh deploy fails `/api/ready` with a clear "db: connection refused" message. Fly.io rolls back automatically. Liveness probe stays cheap (no cascading DB pings).

### Day 0b.3: Observability

**Why**: When something breaks at 2am we need to know what + where without grepping JSON logs by hand.

**Files**
- `package.json`: add `@sentry/nextjs`.
- `instrumentation.ts` at repo root: wraps server with Sentry. PII scrubbing on stack traces (no inputs, no narration text, no API keys).
- `src/lib/util/log.ts` (modify): keep the JSON-line shipper; add `log.metric(name, value, tags)` for key turn-pipeline metrics: `turn.duration_ms`, `narrator.tokens_in`, `narrator.tokens_out`, `narrator.cost_usd`, `tool.validation_failures`, `lock.acquisition_attempts`. These flow into `analytics_events` (table to be created in Phase 8 Day 63).
- `src/app/api/turn/route.ts` + `stream/route.ts`: wrap turn execution in `Sentry.startSpan` so latency + failure rate are visible in Sentry's performance UI.
- New env vars: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`. Validated in `lib/util/env.ts`.
- `docs/OPERATIONS.md` (NEW): how to triage common errors, where to find logs, how to roll back.

**Acceptance**: A synthetic 500 from `/api/turn` shows up in Sentry within 30s with full stack trace + request context (sanitized). Latency p50/p95 visible per route.

### Day 0b.4: E2E smoke test in CI

**Why**: The current CI catches unit + integration regressions but not "the whole thing actually runs". A smoke test that POSTs a turn against an ephemeral environment and verifies the event log is the cheapest insurance.

**Files**
- `tests/e2e/smoke-turn.spec.ts` (NEW): Playwright test. Spins the dev server in CI; does register → start session → POST `/api/turn` with `{ input: "I ooze" }` → poll `/api/state` → assert `turn.begun`, `roll.resolved`, `narration.emitted` events present.
- `.github/workflows/ci.yml` (modify): new job `e2e-smoke` that depends on `unit + integration`, runs the smoke spec against the dev server. Uses the existing pgvector container.
- The smoke test runs against `NARRATOR=template` so it doesn't hit the Anthropic API in CI (cost discipline).

**Acceptance**: CI fails if a regression breaks the turn pipeline end-to-end. Time budget: <2min added to CI runtime.

### Day 0b.5: Connection pooling + Neon pooler URL

**Why**: Without pooling, every API request opens a new Postgres connection. Neon free tier caps at 100; even moderate concurrent traffic exhausts it.

**Files**
- `src/lib/db/client.ts` (modify): use Neon's pooled connection URL (`?pgbouncer=true&connection_limit=10` query string) when the env var is the pooled variant. Fall back to direct URL for dev.
- New env vars: `DATABASE_URL` (pooled, for app), `DATABASE_URL_DIRECT` (unpooled, for migrations). Validated in `env.ts`.
- `scripts/migrate-prod.mjs` (modify): use `DATABASE_URL_DIRECT` to ensure DDL works (PgBouncer in transaction-pool mode breaks DDL).
- `package.json` script `db:migrate:prod` (modify): same.
- `docs/OPERATIONS.md`: section on the two-URL pattern + how to rotate Neon credentials.

**Acceptance**: Load test (Phase 8 Day 65-66, but a small dry-run here): 100 concurrent turns don't exhaust Neon connections. `pg_stat_activity` shows ≤10 connections from the app at peak.

---

## Phase 0c — UI/UX polish (Day 0c.1 - 0c.5, ~5d)

The shipped UI works but doesn't *feel* like a game yet. Five days of polish that make it engaging without changing any mechanics.

### Day 0c.1: Dice-roll animation on `roll.resolved`

**Why**: Right now the result of every action is opaque — the player sees narration but not *why* it went that way. Showing the dice gives them the cause-and-effect that makes a 2d6 PbtA system click.

**Files**
- `src/components/RollReveal.tsx` (NEW): client component. Listens to roll events from the turn-stream payload. Animates 2 dice (CSS keyframes; ~1.2s total) settling on their values + the modifier badge + the band label ("partial", "success", "miss"). On miss/partial, show the negative modifier source ("−2 from bad luck"). Reduced motion respected.
- `src/app/play/page.tsx` (modify): mount `RollReveal` above the latest narration block; auto-scroll keeps it in view.
- Tests: visual regression via Playwright screenshots (3 snapshots: pre-roll, mid-animation, post-roll).

**Acceptance**: Player takes a turn → dice tumble → settle on 4+3+1=8 (partial) → narration follows. Reduced-motion users see a static reveal.

### Day 0c.2: Form-flavor accents

**Why**: Slime UI feels the same as cursed-book UI. Subtle per-form accents (color, typography weight, animation feel) make each form *feel* different beyond the prose.

**Files**
- `content/forms/<id>.json` (modify): add `ui` object — `{ accentColor, secondaryColor, fontFamily, animationFlavor: 'fluid'|'sharp'|'slow' }`.
- `src/lib/forms/theme.ts` (NEW): pure helper, returns CSS variables given a form id. Falls back to neutral.
- `src/app/layout.tsx` (modify): inject form theme as CSS variables on a wrapper div when a session is active.
- Components updated to use `var(--accent)` etc. rather than hard-coded stone colors.
- Slime: green-bog accent, rounded fonts, `fluid` animations. Cursed Book: sepia + ink, serif font, `slow` animations. Dragon-egg: amber + ember, weighted typography, `sharp` animations. Healer: pale blue + warm cream, sans-serif, `fluid`. Dungeon-core: cyan + violet, monospaced, `sharp`.

**Acceptance**: Switching from a slime run to a cursed-book run visibly changes the page chrome. Reduces the "they're all the same screen" feeling.

### Day 0c.3: Turn-in-flight UI (lock state surfaced)

**Why**: With turn-lock added (Phase 0b.1), a player who clicks "submit" twice currently gets a generic 409. They should see "your previous turn is still resolving" with a spinner — not a confusing error.

**Files**
- `src/app/api/turn/route.ts` + `stream/route.ts` (modify): on 409, return `{ error: 'turn_in_flight', currentLockExpiresAt }` so the UI knows when to retry.
- `src/components/InputBox.tsx` (modify): on `turn_in_flight` response, disable input + show "your previous turn is still settling..." spinner. Auto-retry once the lock expires (with jitter).
- Add a small floating "settling..." indicator while the turn-stream is live so players know something is happening even before the first text streams.

**Acceptance**: Double-click submit → second click shows "settling..." rather than an error toast. Tests cover the auto-retry path.

### Day 0c.4: Empty states + recap polish

**Why**: New players hitting `/lore` see an empty page with no explanation. Death recap is a flat text block with no weight. Both moments are wasted opportunities.

**Files**
- `src/app/lore/page.tsx`: empty state with prose ("the world is still gathering its memory. come back tomorrow.") + a small ticker of upcoming chapter advances.
- `src/app/character/page.tsx`: empty state for users with 0 campaigns ("you have not yet been anything. begin your first reincarnation to populate this page.")
- `src/app/leaderboard/page.tsx`: empty state for fresh windows.
- `src/components/Recap.tsx` (modify): on death, show:
  - A scrim overlay (subtle red gradient).
  - The roll result that killed (if known).
  - A 2-line epitaph slot (sets up Phase 5.5 Day 30 epitaph feature).
  - "begin again" CTA + "share this run" link (sets up Phase 2 Day 10 share token).
  - On win: gold-tinted scrim + summary stats + share link.
  - On cap: blue-grey scrim + "the night ends without verdict" + share link.

**Acceptance**: First-time `/lore` visit doesn't look broken. Death feels like a *moment*, not a state change. Win feels earned.

### Day 0c.5: Onboarding nudges

**Why**: First-time players don't know what verbs work, what the energy bar means, or that they can rename items. Three contextual hints in the first 5 turns close the gap without a heavy tutorial (until Phase 5.5 Day 36-37 lands the proper tutorial).

**Files**
- `src/lib/onboarding/nudges.ts` (NEW): pure rules engine. Given `{ user, session, projection, recentEvents }`, returns up to 1 nudge per turn from a catalog: "try `sense` to perceive your surroundings"; "tap your inventory item to rename it"; "energy refills at 1 per 45 min on free tier".
- `src/components/NudgeToast.tsx`: dismissable toast that auto-fades after 8s. State persisted in `users.nudges_dismissed jsonb` so a nudge fires at most once per user.
- Hook into `/play/page.tsx` `useEffect`: on each new turn, check if a nudge applies + show.

**Acceptance**: A fresh user sees ~3 nudges in their first session. After dismissing, they don't see those again. Tests cover the predicate rules.

---

## Phase 0d — Engagement quick wins (Day 0d.1 - 0d.3, ~3d)

### Day 0d.1: Threat-NPC integration tests + content validation in CI

**Why**: 4 threat NPCs were authored but no test confirms they actually fire from form-specific hard-moves at runtime. Without coverage they could rot silently if narrator prompts change.

**Files**
- `tests/integration/threat-npcs.test.ts` (NEW): for each form (slime, cursed-book, dragon-egg, dungeon-core), force a partial-success roll on a beat that triggers a hard-move that introduces the threat NPC. Assert `npc.introduced` event with the right `templateId`.
- `.github/workflows/ci.yml` (modify): add `npm run content:validate` to the validation job. If any content file references a missing template, CI fails.
- Refactor `scripts/validate-content.ts` if needed to cover NPC template references from form hard-moves.

**Acceptance**: Adding a new form with a missing NPC reference fails CI before merge. The 4 existing threat NPCs are pinned by tests so a refactor can't silently break them.

### Day 0d.2: Today's-runs ticker + streak prominence

**Why**: The homepage is sparse. New players don't see *anyone else playing*. Existing players don't see their streak prominently. Both are quick wins.

**Files**
- `src/app/api/world/today/route.ts` (NEW): returns the last ~10 noteworthy events from the current UTC day — famous deaths (when Phase 5.5 Day 28 lands), big roll outcomes, Wyrm-arc damage, lore writes. For now, just sample from existing event types: deaths, wins, big partial-success moments. Cached 5min.
- `src/components/TodayTicker.tsx`: scrolling marquee on the homepage. "Embershade fell to the rust-tongued patrol... a slime won at turn 47... the wyrm's attunement ticked +2..."
- `src/components/Nav.tsx` (modify): move streak count from the EnergyBar to the top-right of the global nav, next to coin balance (when coins land in Phase 5 Day 18-19). Until then, it's the streak alone — visible from every page.

**Acceptance**: Homepage shows real activity. Streak is visible globally, not buried.

### Day 0d.3: Session lobby surface

**Why**: We have presence + chat shipped, but no easy way to *find* who's playing. A small "now playing" panel turns isolated runs into a felt community.

**Files**
- `src/app/api/world/playing-now/route.ts` (NEW): returns currently-active sessions (heartbeat within last 5min). Per-session: anonymized form, location, turn count, faction (when Phase 7 Day 42-43 lands). No player names without consent (`users.show_in_lobby` boolean default true; opt-out in settings).
- `src/components/NowPlaying.tsx`: collapsed sidebar panel on home + `/play` showing 5-10 active runs ("a slime is in the collapsed-tunnel, turn 8"). Click → spectate (read-only follow of their narration; ties into Phase 2 Day 10 share-token infrastructure).
- `src/app/settings/page.tsx`: add `show_in_lobby` toggle.

**Acceptance**: Players can see other people are playing right now. Clicking a row opens a spectator view (rate-limited; soft cap on spectator count to control cost).

**Gotchas**
- Spectator view should NOT trigger turn events on the watched session. Read-only.
- Heartbeat updates already exist (presence). Reuse the same plumbing.

---

## Phase 0e — Cleanup sweep (Day 0e, ~1d)

A dedicated half-day each for:

**Scripts standardization** — pick one of `.ts` (via `tsx`) or `.mjs`. Current mix is incidental. Recommend: `.ts` for everything, since it's the rest of the codebase. Convert the `.mjs` scripts. Update `package.json` script entries.

**Dead code sweep** — run `unused-imports`, `ts-prune`, or equivalent. Remove anything orphaned. Update tests if any depended on removed exports.

**Doc accuracy pass** — `README.md`, `docs/ARCHITECTURE.md`, `docs/MECHANICS.md` were written before the turn-lock + safety-module + speculative-events refactor. Walk each doc; correct anything stale.

---

## Open decisions

| # | Decision | Default if not raised |
|---|---|---|
| P1 | Turn-lock orphan-cleanup interval: 5 min, or aggressive (1 min)? | 5 min for v1; tune via telemetry if stuck-lock incidents accrue |
| P2 | Sentry tier: free (5k events/mo) or paid? | Free for v1; revisit after launch |
| P3 | Empty-state copy: in-character ("the world is gathering its memory") or out-of-character ("no lore yet")? | In-character |
| P4 | Nudge cap: max 1 per turn, or 1 per session? | 1 per turn (different conditions can trigger different nudges in same session) |
| P5 | "Now playing" panel: opt-in to be visible, or opt-out? | Opt-out (default visible); privacy-conscious users disable |
| P6 | Spectator view: full event log + narration, or summarized? | Narration only — same as run-share, just live |
| P7 | Form theme: per-form or per-faction? | Per-form for v1; faction overrides could come post-Phase-7 |
| P8 | Connection pool size: 10 or 20? | 10 for v1; Neon free tier tops at 100 total |
| P9 | E2E smoke in CI: against template narrator only, or also remote (one paid call)? | Template only in CI; remote tested in staging via manual trigger |

---

## Hand-off to Phase 1

After Phase 0 lands (~14 dev days), the foundation looks like:

- **Code**: turn-lock hardened, validation decoupled from persistence, safety caps centralized.
- **Operations**: real readiness probe, observability (Sentry + structured metrics), connection-pooled DB, E2E smoke catching regressions.
- **UI**: dice animation, form-flavor accents, turn-in-flight surface, empty-state polish, onboarding nudges.
- **Engagement**: today's-runs ticker, prominent streak, session lobby with spectate.
- **Hygiene**: scripts standardized, dead code purged, docs current, content validation in CI.

That's the platform Phase 1's predicate engine will ride on. After Phase 0e, we open Phase 1 (predicate engine) of `POST_MVP_PLAN.md` with confidence that the foundation won't shift underneath the long-term plan.

## What this plan is NOT

- Not a substitute for `POST_MVP_PLAN.md`. Polish first; features after.
- Not exhaustive — we'll find more polish work as we go. Anything new gets queued at the end of 0e or rolled into the appropriate phase.
- Not all-or-nothing — if we ship Phase 0a + 0b + 0d but skip 0c, that's a defensible call (foundation matters more than chrome). Don't skip 0a or 0b.
