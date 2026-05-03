# Reincarnated in Another World as...

A persistent text RPG where every reincarnation form plays as a fundamentally different game. The backend owns the truth; the AI writes the prose. The world remembers.

> **Status:** v0.1.0 — anonymous player completes a 10-turn slime run end-to-end. Local dev fully working; Fly.io deploy artifacts committed (awaiting credentials). See [docs/POSTMORTEM.md](docs/POSTMORTEM.md) for the 14-day retrospective and what's deferred.

## What it is

You wake up reincarnated. Maybe as a slime. Maybe as a cursed book. Maybe as a dungeon core. Each form changes what the AI is *allowed* to do, not just how it describes things — a slime has no hands, no eyes, no voice, and the tool-calling backend enforces that.

- **2d6 PbtA resolution** — 10+ success, 7-9 partial (with form-specific hard-move), 6- miss. Server rolls, server validates, the dice can't lie.
- **Event-sourced** — every action is an immutable event. Replay any session from zero. Branch any timeline.
- **Form-aware mechanics** — vitals, stats, verbs, hard-moves all per form. A slime's analog to HP is cohesion, not hit points.
- **Two-tier memory** — canonical Postgres entities by ID, episodic pgvector summaries for retrieval.

## MVP carve (v0.1)

- ONE form: Lesser Slime
- ONE location: Collapsed Dungeon Tunnel
- ONE quest: survive the night (5 hand-authored beats)
- 10-turn cap, anon session, no auth
- Acceptance: anonymous player completes a 10-turn run, lives or dies, sees a recap

Form #2 (Cursed Book) drops in M4 and validates the form-template architecture as a category. See [docs/PLAN.md](docs/PLAN.md) for the full milestone breakdown.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript strict |
| DB | Postgres 16 + pgvector (local: Docker; prod: Neon) |
| ORM | Drizzle |
| AI | Anthropic Claude Sonnet 4.6 (narration) + Haiku 4.5 (classifier, tone-check) |
| Embeddings | Voyage `voyage-3-lite` (512-dim) |
| Tests | Jest unit/integration, Playwright e2e |
| Deploy | Fly.io |
| Cookie | `jose` HS256, anon session ID |

## Local development

```bash
# 1. Install deps
npm install

# 2. Configure environment
cp .env.example .env.local
# WSL2 gotcha: localhost forwarding to a WSL-side container is unreliable.
# If running Docker-in-WSL, run `wsl hostname -I` and use that IP for
# DATABASE_URL host. Otherwise localhost works.

# 3. Bring up Postgres + WSL keepalive (one terminal — Ctrl-C to stop)
npm run dev:up

# 4. In another terminal: migrate + seed + run
npm run db:migrate
npm run db:seed
npm run dev    # default NARRATOR=template, no API calls
```

Set `NARRATOR=remote` (and `ANTHROPIC_API_KEY` + `VOYAGE_API_KEY`) in `.env.local` to switch to Sonnet 4.6 narration with prompt caching + voyage-3-lite memory embeddings.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev:up` | Bring up Postgres + WSL keepalive in one foreground command |
| `npm run dev:down` | Stop the Postgres container |
| `npm run dev` | Next.js dev server at <http://localhost:3000> |
| `npm run build` | Production build (uses `output: standalone` for the Docker image) |
| `npm run start` | Run production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | tsc --noEmit |
| `npm run format` | Prettier write |
| `npm run db:push` | Drizzle push schema to local DB (no migration files) |
| `npm run db:generate` | Generate migration SQL from schema diffs |
| `npm run db:migrate` | Apply generated migrations |
| `npm run db:seed` | Load `content/*` into `templates_*` tables |
| `npm test` | Unit then integration (sequential — DB suites need exclusive Postgres access) |
| `npm run test:unit` | Pure unit tests, parallel |
| `npm run test:integration` | DB-backed tests, `--runInBand` |
| `npm run test:e2e` | Playwright e2e (requires `npm run dev` running) |
| `npm run eval` | Run the 20 golden scenarios against the configured narrator |

## Documentation

- [CLAUDE.md](CLAUDE.md) — agent guidance: stack, conventions, slash-command etiquette
- [docs/PLAN.md](docs/PLAN.md) — the approved 14-day MVP build plan
- [docs/BRIEF.md](docs/BRIEF.md) — original product/design brief
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — per-turn flow, projection, atomicity, injection defense
- [docs/MECHANICS.md](docs/MECHANICS.md) — 2d6 PbtA tables, form-stat ranges, hard-move menus
- [docs/DECISIONS.md](docs/DECISIONS.md) — ADR log
- [docs/ROADMAP.md](docs/ROADMAP.md) — burn-down through Day 14
- [docs/EVAL.md](docs/EVAL.md) — golden scenarios, scoring rubric
- [docs/POSTMORTEM.md](docs/POSTMORTEM.md) — v0.1.0 retrospective

## License

Source code: MIT (TBD). Game content under `content/` is CC BY-NC 4.0 — see [content/LICENSE](content/LICENSE).
