# Reincarnated in Another World as...

A persistent text RPG where every reincarnation form plays as a fundamentally different game. The backend owns the truth; the AI writes the prose. The world remembers.

> **Status:** Pre-v0.1 — scaffolding (Day 1 of [the 14-day plan](docs/PLAN.md)).

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

# 2. Start Postgres + pgvector (port 5433 — avoids clash with VH Health)
docker-compose up -d

# 3. Configure environment
cp .env.example .env.local
# Edit .env.local: ANTHROPIC_API_KEY, VOYAGE_API_KEY, SESSION_SECRET

# 4. Run migrations + seed
npm run db:push
npm run db:seed

# 5. Dev server (default narrator: TemplateNarrator, no AI calls)
npm run dev
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server at <http://localhost:3000> |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | tsc --noEmit |
| `npm run format` | Prettier write |
| `npm run db:push` | Drizzle push schema to local DB (no migration files) |
| `npm run db:generate` | Generate migration SQL from schema diffs |
| `npm run db:migrate` | Apply generated migrations |
| `npm run db:seed` | Load `content/*` into `templates_*` tables |
| `npm test` | Jest unit + integration |
| `npm run test:e2e` | Playwright e2e |
| `npm run eval` | Run the 20 golden scenarios against the configured narrator |

## Documentation

- [docs/PLAN.md](docs/PLAN.md) — the approved 14-day MVP build plan
- [docs/BRIEF.md](docs/BRIEF.md) — original product/design brief
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — per-turn flow, projection, atomicity, injection defense
- [docs/MECHANICS.md](docs/MECHANICS.md) — 2d6 PbtA tables, form-stat ranges, hard-move menus
- [docs/DECISIONS.md](docs/DECISIONS.md) — ADR log
- [docs/ROADMAP.md](docs/ROADMAP.md) — burn-down, current day
- [docs/EVAL.md](docs/EVAL.md) — golden scenarios, scoring rubric

## License

Source code: MIT (TBD). Game content under `content/` is CC BY-NC 4.0 — see [content/LICENSE](content/LICENSE).
