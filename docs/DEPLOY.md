# Deploying reincarnated-rpg

End-to-end recipe for shipping the app to Fly.io with Neon Postgres,
Sentry observability, and a custom domain. ~30-60 minutes start to
finish, most of it waiting on Neon provisioning + DNS propagation.

## Prerequisites

- **Fly.io account** + `flyctl` installed and logged in (`fly auth login`)
- **Neon account** with a fresh Postgres + pgvector project
- **Anthropic API key** (`sk-ant-…`) — the narrator depends on it
- **Voyage API key** (`pa-…`) — the embeddings layer depends on it
  for cross-run memory; runs in mock-mode if absent (see below)
- **Sentry account** (optional but recommended) — for production
  error tracking via the no-SDK envelope wrapper
- A domain you control if you want a custom URL

## Step 1 — Provision Neon Postgres + pgvector

1. Create a new Neon project, region close to your Fly primary
   (`bom` for IAD/SFO/EWR alternates).
2. In the Neon SQL console:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. From Neon's dashboard, grab **two** connection strings:
   - **Pooled** (URL contains `-pooler.`, used as `DATABASE_URL`):
     `postgresql://<user>:<pass>@<host>-pooler.<region>.aws.neon.tech/<db>?sslmode=require`
   - **Direct** (no `-pooler.`, used as `DATABASE_URL_DIRECT` for
     migrations only — pgbouncer in tx-pool mode breaks DDL):
     `postgresql://<user>:<pass>@<host>.<region>.aws.neon.tech/<db>?sslmode=require`

## Step 2 — One-time Fly app creation

From a clean checkout of `master`:

```bash
fly launch --copy-config --no-deploy
# Accept the existing fly.toml. Don't let `fly launch` create a new
# Postgres — we use Neon instead.
```

This creates the app object on Fly without yet pushing an image.

## Step 3 — Set Fly secrets

Replace each `<…>` with real values. `SESSION_SECRET` MUST be 32+
random bytes — generate fresh, do NOT reuse the dev one.

```bash
fly secrets set \
  DATABASE_URL='<pooled-neon-url>' \
  DATABASE_URL_DIRECT='<direct-neon-url>' \
  SESSION_SECRET="$(openssl rand -base64 32)" \
  ANTHROPIC_API_KEY='sk-ant-<…>' \
  VOYAGE_API_KEY='pa-<…>' \
  NARRATOR='remote' \
  AI_PROVIDER='anthropic'
```

If you'd rather run the cheaper MiniMax narrator in production, swap
the AI block:

```bash
fly secrets set \
  AI_PROVIDER='openai-compatible' \
  OPENAI_BASE_URL='https://api.minimax.io/v1' \
  OPENAI_MODEL='MiniMax-M2.7-highspeed' \
  OPENAI_API_KEY='sk-cp-<…>'
```

(NARRATOR=remote covers both — the factory routes via AI_PROVIDER.)

For Sentry observability:

```bash
fly secrets set \
  SENTRY_DSN='https://<key>@o<orgId>.ingest.sentry.io/<projectId>'
```

When unset, all `captureException` calls in
`src/lib/observability/sentry.ts` no-op cleanly. The `/api/metrics`
endpoint always returns the rest of the JSON snapshot (process,
sessions, ai_calls), with `sentry: { configured: false }`.

## Step 4 — Deploy + migrate + seed + smoke

```bash
# Build + push the image. With our .dockerignore + Dockerfile this
# produces a ~250 MB runtime image.
fly deploy

# After the first machine boots, apply migrations (uses
# DATABASE_URL_DIRECT to bypass pgbouncer):
fly ssh console -C "node scripts/migrate-prod.mjs"

# Load reference content (forms / locations / NPCs / etc.):
fly ssh console -C "node scripts/seed-runtime.mjs"

# Smoke a turn end-to-end against the live app:
fly ssh console -C "node scripts/smoke.mjs http://127.0.0.1:3000"
```

The smoke script POSTs `/api/session`, then `/api/turn/stream` with a
preset verb, and asserts the response shape. If it 200s with prose,
you're live.

## Step 5 — Verify health + readiness

Fly's deploy gate uses `/api/ready` (not `/api/health`) for rollout —
so a misconfigured deploy auto-rolls back. Manual sanity from your
laptop:

```bash
# Liveness — should always 200 with { status: 'ok', commit, version }
curl -fsS https://reincarnated-rpg.fly.dev/api/health | jq

# Readiness — 200 only if DB + pgvector + content + Anthropic all pass
curl -fsS https://reincarnated-rpg.fly.dev/api/ready | jq

# Metrics — process / sessions / ai_calls / errors / sentry status
curl -fsS https://reincarnated-rpg.fly.dev/api/metrics | jq
```

If `/api/ready` returns 503, the JSON body names the failing check
(database / pgvector / content / anthropic).

## Step 6 — Custom domain (optional)

```bash
# Reserve an IPv4 + IPv6 for the app
fly ips allocate-v4
fly ips allocate-v6

# Point your DNS at the addresses fly returns
# (typically: A record → IPv4, AAAA record → IPv6)

# Issue a Let's Encrypt cert
fly certs add play.<your-domain>.com

# Wait for DNS to propagate, then verify
fly certs check play.<your-domain>.com
```

## Step 7 — Roll forward / roll back

Tag-based releases keep the audit trail clean:

```bash
# Roll forward
git tag v0.1.X
git push --tags
fly deploy

# Roll back to a known-good image (find with `fly releases list`)
fly deploy --image registry.fly.io/reincarnated-rpg:deployment-<sha>
```

## Operational notes

- **Concurrency.** `fly.toml` sets soft 50 / hard 100 reqs per
  machine. Tune based on observed `ai_calls` p99 — narration is the
  hot path, ~2-5s per turn with cache hits. Add machines via
  `fly scale count N` if soft-limit pressure shows up in `/api/metrics`.
- **Auto-stop.** `auto_stop_machines = stop` and
  `min_machines_running = 0` mean the VM hibernates when idle; cold
  start is ~3-5s on first request. Acceptable for a v0 with low
  traffic; flip to `min_machines_running = 1` if cold-start pain
  surfaces with real users.
- **Cost ceiling.** The per-user `cost-gate.ts` caps Anthropic spend
  at $0.50/day/user by default. Adjust the cap in `src/lib/ai/cost-gate.ts`
  before launch if you expect heavy users.
- **Backups.** Neon retains 7-day point-in-time. For higher RPO,
  schedule `pg_dump` against `DATABASE_URL_DIRECT` to S3-compatible
  storage from a GitHub Action. (Not yet implemented; tracked in the
  POST_MVP roadmap as "backup + replay-from-zero CI".)
- **Replay-from-zero.** The events table is append-only (Postgres
  rule blocks DELETE/UPDATE). To rebuild a session's projection from
  scratch:
  `node scripts/replay-from-zero.ts --session=<sessionId>`.

## Troubleshooting

- **`/api/ready` returns 503 on `database`.** Most often a missing
  `DATABASE_URL` secret or a typo. Check `fly secrets list`.
- **`/api/ready` returns 503 on `pgvector`.** The Neon project doesn't
  have the extension installed. Re-run `CREATE EXTENSION vector` in
  the SQL console.
- **`/api/ready` returns 503 on `anthropic`.** API key is missing or
  revoked. Check Anthropic console + `fly secrets list`.
- **Migrations fail with `ERROR: prepared statement … does not exist`.**
  You're hitting the pooler, not the direct URL. Make sure
  `DATABASE_URL_DIRECT` is set as a Fly secret and points at the
  non-pooled host.
- **Image build fails with `next build` errors.** `.dockerignore`
  may have changed; ensure `node_modules` and `.next` are excluded
  so the builder stage rebuilds cleanly.
- **First turn returns `out of energy`.** Anonymous sessions get
  free turns; the user account flow has tiered energy. Either log
  in or check `/api/me` for the energy ledger state.

## Pre-launch checklist (before announcing the URL)

- [ ] `/api/health` 200 from production URL
- [ ] `/api/ready` 200 (all 4 checks pass)
- [ ] `/api/metrics` returns `sentry.configured: true`
- [ ] Manual session: POST `/api/session`, take 3 turns, see narration
- [ ] Mobile viewport tested on a real phone (iOS Safari + Android Chrome)
- [ ] First-time-player onboarding nudges fire (delete localStorage
      `rrpg.dismissedNudgeIds` to reset)
- [ ] Sentry receives a test exception (trigger via a 404 or
      synthetic error)
- [ ] Custom domain HTTPS cert is green (`fly certs check`)
- [ ] Cost cap `$0.50/day/user` is sane for current Anthropic pricing
- [ ] `fly scale count` matches expected concurrency (1 for soft launch)
