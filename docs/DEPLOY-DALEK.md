# Deploying reincarnated-rpg on Dalekdefender (home tailnet k3s)

End-to-end recipe for running the app on the same Dalek box that
already hosts the dev Postgres. Tailnet-only HTTPS via `tailscale
serve`; flip to `tailscale funnel` when ready for public access.

**Why Dalek over Fly:** zero marginal cost, app and DB share the
same node (single-digit-ms queries, no network round-trip), you
already know the recipe (P8 was the dev-DB migration). Caveat:
home-internet single point of failure. Fine for soft launch + first
~50 players. See `docs/DEPLOY.md` for the Fly.io recipe if you
outgrow this.

## Prerequisites

- Dalekdefender already running k3s with the `reincarnated`
  namespace + Postgres pod (P8 from the 2026-05-05 session;
  see `infra/dalekdefender/README.md`).
- `ssh dd` works from your laptop (the existing Dalek alias).
- `docker build` works on your laptop (Docker Desktop is enough).
- Tailscale logged in on Dalek (already so for the DB tunnel).

## Step 1 — Build the production image locally

The image isn't pushed to a registry — we build on the laptop, save
to a tar, scp to Dalek, import into k3s containerd. No registry, no
auth tokens. Slow only on the first build (subsequent builds re-use
the npm-deps cache layer).

```bash
# From the repo root, with master checked out and clean:
docker build -t reincarnated-rpg:latest .

# Tar + ship to Dalek:
docker save reincarnated-rpg:latest -o /tmp/reincarnated-rpg.tar
scp /tmp/reincarnated-rpg.tar dd:/tmp/

# Import into k3s containerd:
ssh dd 'sudo -n k3s ctr images import /tmp/reincarnated-rpg.tar && \
        sudo -n rm /tmp/reincarnated-rpg.tar'
```

Verify the image is visible to k3s:

```bash
ssh dd 'sudo -n k3s ctr images ls | grep reincarnated-rpg'
# expect: docker.io/library/reincarnated-rpg:latest …
```

## Step 2 — One-time secret bootstrap

```bash
# Copy the template to a real (gitignored) secret file:
cp infra/dalekdefender/manifests/app-secret.example.yaml \
   infra/dalekdefender/manifests/app-secret.yaml

# Edit infra/dalekdefender/manifests/app-secret.yaml in place:
#   - DATABASE_URL: in-cluster URL with the real PG password (the
#     same one in your .env.local; it's in
#     reincarnated-postgres-creds Secret in the same namespace, or
#     fetch it: ssh dd 'sudo -n kubectl -n reincarnated get secret
#     reincarnated-postgres-creds -o jsonpath="{.data.POSTGRES_PASSWORD}"
#     | base64 -d')
#   - SESSION_SECRET: openssl rand -base64 32 (do NOT reuse dev one)
#   - One of ANTHROPIC_API_KEY OR the OPENAI_* MiniMax block
#   - VOYAGE_API_KEY (optional; falls back to mock embeddings)
#   - SENTRY_DSN (optional; no-op when blank)

# Apply it:
ssh dd 'sudo -n kubectl apply -f -' \
  < infra/dalekdefender/manifests/app-secret.yaml

# Verify:
ssh dd 'sudo -n kubectl -n reincarnated get secret reincarnated-app-secrets'
```

## Step 3 — Apply the app manifests

```bash
ssh dd 'sudo -n kubectl apply -f -' \
  < infra/dalekdefender/manifests/app-deployment.yaml
ssh dd 'sudo -n kubectl apply -f -' \
  < infra/dalekdefender/manifests/app-service.yaml

# Watch the rollout:
ssh dd 'sudo -n kubectl -n reincarnated rollout status \
        deploy/reincarnated-app --timeout=120s'
```

The pod should reach Ready within ~30s (startup probe + 5s warm).
Tail logs if it doesn't:

```bash
ssh dd 'sudo -n kubectl -n reincarnated logs -f deploy/reincarnated-app'
```

## Step 4 — Run migrations + seed

```bash
# Migrations (one-shot Job, idempotent):
ssh dd 'sudo -n kubectl apply -f -' \
  < infra/dalekdefender/manifests/app-migrate-job.yaml

# Watch:
ssh dd 'sudo -n kubectl -n reincarnated wait --for=condition=complete \
        job/reincarnated-migrate --timeout=120s'

# Seed reference content:
ssh dd 'sudo -n kubectl apply -f -' \
  < infra/dalekdefender/manifests/app-seed-job.yaml

ssh dd 'sudo -n kubectl -n reincarnated wait --for=condition=complete \
        job/reincarnated-seed --timeout=120s'
```

If a Job needs to re-run, delete it first:

```bash
ssh dd 'sudo -n kubectl -n reincarnated delete job reincarnated-migrate'
# then re-apply.
```

## Step 5 — Smoke test from inside the cluster

```bash
# Port-forward the NodePort temporarily so you can hit /api/ready
# from your laptop without the tailscale layer:
ssh dd -L 30000:localhost:30000 -N &
PF_PID=$!

curl -fsS http://127.0.0.1:30000/api/health | jq
# { status: "ok", commit: "...", version: "..." }

curl -fsS http://127.0.0.1:30000/api/ready | jq
# { status: "ready", checks: { database: { ok: true, … }, ... } }

curl -fsS http://127.0.0.1:30000/api/metrics | jq
# { sentry: { configured: true|false }, aiCalls: {...}, ... }

kill $PF_PID
```

If `/api/ready` returns 503, the body names which check failed
(database / pgvector / content / anthropic). Most common: the
`anthropic` check fails because the `ANTHROPIC_API_KEY` secret is
missing or set to a stale key. Fix the secret with `kubectl patch`
(see `app-secret.example.yaml` header).

## Step 6 — Expose via tailscale (tailnet-only, soft launch)

```bash
# Map port 443 (HTTPS, tailscale-managed cert) → NodePort 30000.
# --bg keeps it running across SSH sessions.
ssh dd 'sudo -n tailscale serve --bg --https=443 \
        --set-path / http://localhost:30000'

# Verify:
ssh dd 'sudo -n tailscale serve status'
# https://dalekdefender.<your-tailnet>.ts.net (tailnet only)
# `--+https` available on tailnet ✓
```

The app is now reachable at
`https://dalekdefender.<your-tailnet>.ts.net/` from any device on
your tailnet (including phones with the tailscale app). Share the
URL with friends-on-tailscale; iterate.

## Step 7 — Public access (optional, when ready)

Tailscale Funnel exposes the same URL to the public internet, with
a free tailscale-managed cert. Account-level opt-in:

```bash
# Enable funnel for the node (one-time, in tailscale admin UI):
# https://login.tailscale.com/admin/acls — toggle Funnel for the
# node, plus add the ACL "src=*, dst=dalekdefender:443"

# Then start funnel (replaces the serve mapping):
ssh dd 'sudo -n tailscale funnel --bg --https=443 \
        --set-path / http://localhost:30000'

# Verify from a non-tailnet network:
curl -fsS https://dalekdefender.<your-tailnet>.ts.net/api/health
```

## Step 8 — Update flow

When you ship a new version of the app:

```bash
# 1. Build + ship + import the new image (Step 1):
docker build -t reincarnated-rpg:latest .
docker save reincarnated-rpg:latest -o /tmp/reincarnated-rpg.tar
scp /tmp/reincarnated-rpg.tar dd:/tmp/
ssh dd 'sudo -n k3s ctr images import /tmp/reincarnated-rpg.tar && \
        sudo -n rm /tmp/reincarnated-rpg.tar'

# 2. Restart the deployment so it pulls the new image:
ssh dd 'sudo -n kubectl -n reincarnated rollout restart \
        deploy/reincarnated-app'

# 3. If the release includes new migrations:
ssh dd 'sudo -n kubectl -n reincarnated delete job reincarnated-migrate'
ssh dd 'sudo -n kubectl apply -f -' \
  < infra/dalekdefender/manifests/app-migrate-job.yaml
ssh dd 'sudo -n kubectl -n reincarnated wait --for=condition=complete \
        job/reincarnated-migrate --timeout=120s'

# 4. Smoke (Step 5).
```

Tag the release in git so you can correlate Sentry stack traces +
`/api/health`'s `commit` field with the deployed code:

```bash
git tag v0.1.X && git push --tags
```

## Daily ops

| Task | Command |
|---|---|
| Rollout status | `ssh dd 'sudo -n kubectl -n reincarnated rollout status deploy/reincarnated-app'` |
| Restart pod | `ssh dd 'sudo -n kubectl -n reincarnated rollout restart deploy/reincarnated-app'` |
| Tail app logs | `ssh dd 'sudo -n kubectl -n reincarnated logs -f deploy/reincarnated-app'` |
| Shell in app pod | `ssh dd 'sudo -n kubectl -n reincarnated exec -it deploy/reincarnated-app -- sh'` |
| Re-read /api/metrics | port-forward to 30000 (Step 5) and `curl /api/metrics` |
| Patch one secret | see `app-secret.example.yaml` header for the `kubectl patch` recipe |
| Re-run a Job | delete it (`kubectl delete job …`), then re-apply the manifest |
| Take down funnel | `ssh dd 'sudo -n tailscale funnel --https=443 off'` |
| Take down serve | `ssh dd 'sudo -n tailscale serve --https=443 off'` |
| Full app teardown | `ssh dd 'sudo -n kubectl -n reincarnated delete deploy/reincarnated-app svc/reincarnated-app secret/reincarnated-app-secrets'` (DB stays) |

## Troubleshooting

- **Pod stuck in `ImagePullBackOff`.** The `imagePullPolicy:
  IfNotPresent` matches the image-import flow, but if the import
  failed the pod can't find it. Verify with
  `ssh dd 'sudo -n k3s ctr images ls | grep reincarnated-rpg'`. If
  empty, repeat Step 1.
- **`/api/ready` returns 503 on `database`.** The DATABASE_URL in
  the secret is wrong. Most likely the password — it must match
  what's in `reincarnated-postgres-creds` Secret. Fetch it with the
  one-liner in Step 2.
- **`/api/ready` returns 503 on `pgvector`.** The Postgres pod
  doesn't have the extension. The image is `pgvector/pgvector:pg16`
  so it should be available; check with
  `ssh dd 'sudo -n kubectl -n reincarnated exec deploy/reincarnated-postgres -- psql -U reincarnated -d reincarnated -c "\\dx"'`.
  If absent, run `CREATE EXTENSION vector` against the DB.
- **Migrate Job fails with prepared-statement errors.** Should not
  happen here (no pgbouncer in front of the in-cluster PG). If it
  does, check `DATABASE_URL_DIRECT` in the secret matches the
  pooled URL.
- **`/api/ready` returns 503 on `anthropic`.** Only fires when
  `NARRATOR=remote` AND `AI_PROVIDER=anthropic` AND
  `ANTHROPIC_API_KEY` is missing/revoked. The MiniMax path
  (`AI_PROVIDER=openai-compatible`) skips this check entirely; the
  route reports `skipped (AI_PROVIDER=openai-compatible)`. If you've
  configured Anthropic intentionally, fetch the key from your secret
  store and re-apply.

## Pre-launch checklist

- [ ] Image imported into k3s containerd
- [ ] Secret applied (verify with `kubectl get secret`)
- [ ] Deployment + Service applied
- [ ] Migrate + Seed Jobs completed
- [ ] `/api/health` 200 from the port-forward
- [ ] `/api/ready` 200 (all 4 checks pass)
- [ ] `/api/metrics` returns expected shape
- [ ] Manual session: POST `/api/session`, take 3 turns, see narration
- [ ] Mobile viewport tested on a real phone (iOS Safari + Android Chrome)
- [ ] First-time-player onboarding nudges fire correctly
- [ ] Sentry receives a test exception (or `sentry.configured: false`
      if you didn't wire it)
- [ ] `tailscale serve` mapping is `--bg` (survives SSH session close)
- [ ] Cost cap `$0.50/day/user` is sane for current Anthropic /
      MiniMax pricing
