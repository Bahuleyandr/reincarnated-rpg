@AGENTS.md

# Reincarnated RPG — agent guidance

A persistent text RPG where every reincarnation form (slime, cursed book, dragon egg, dungeon core, healer, ...) plays as a fundamentally different game. The world remembers what you did.

## Source-of-truth files

- **`docs/PLAN.md`** — the approved 14-day MVP build plan. Day-by-day tasks, schema, interfaces, eval coverage matrix. **Read this first when resuming work.**
- **`docs/BRIEF.md`** — the original product/design brief. Use to recover *why* a given decision was made.
- **`docs/ROADMAP.md`** — burn-down and current day. Update as you complete tasks.
- **`docs/ARCHITECTURE.md`** — per-turn flow, projection strategy, tool atomicity, prompt-injection defense.
- **`docs/MECHANICS.md`** — 2d6 PbtA tables, form-stat ranges, hard-move menus.
- **`docs/DECISIONS.md`** — ADR-style log of locked decisions.
- **`docs/EVAL.md`** — golden-scenario format, scoring rubric, judge prompt.

## Core principles (do not violate)

1. **Backend owns truth; the narrator writes prose.** The model never mutates state. It calls validated tools or it narrates only. There is no "trust the model" path.
2. **Event log is append-only.** A Postgres rule blocks DELETE/UPDATE on `events`. Replay-from-zero must always work.
3. **Form-aware mechanics.** A slime and a book do not share a stat block. Each form has its own vitals/stats/verbs/hard-moves.
4. **Tiered inference.** Cheap models classify and check tone; one expensive call per turn does narration.
5. **Tool-call atomicity.** All tools in a single model response succeed-or-rollback as one event batch.
6. **Entity-ID discipline.** New NPCs/locations/items reference template IDs from `content/`. The model does not invent "Goblin Knight Elara" mid-narration.

## House conventions

- **Stack**: Next.js 16 (yes, 16 — see `AGENTS.md` warning), React 19, TypeScript strict, `@/*` alias for `src/`.
- **DB**: Drizzle ORM + Postgres 16 + pgvector. Local dev via `docker-compose up -d`. Prod: Neon.
- **AI**: Anthropic SDK only for v0.1. Sonnet 4.6 narration, Haiku 4.5 classifier + tone-checker. Voyage `voyage-3-lite` (512-dim) embeddings.
- **Tests**: Jest unit/integration via `next/jest` preset, Playwright e2e.
- **Tooling**: ESLint 9 flat config, Prettier 3, Tailwind v4, `unused-imports` plugin.
- **Cookie auth**: `jose` HS256, `SESSION_SECRET` 32 random bytes, anon-only for v0.1.

## Slash-command etiquette

- For broad codebase research, use `Explore` agent rather than direct grep.
- For implementation planning of new features (post-MVP), invoke `make-plan` skill.
- `/health` and `/review` (gstack) are available; do not run on every turn — only on PR-ready checkpoints.

## Things that look wrong but are not

- **No `git config` changes ever.** Commit author email is set per-commit via `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_EMAIL` env vars (noreply form). pm.me email triggers GH007 push reject.
- **Postgres on port 5433**, not 5432. Avoids clash with VH Health's local Postgres.
- **The slime form has no language and no hands.** The system prompt enforces a negative vocabulary (no `hand`, `see`, `speak`, etc.). This is by design; do not "fix" the prose.
