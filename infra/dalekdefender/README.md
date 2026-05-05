# Dalekdefender — Postgres for Reincarnated RPG (dev only)

Always-on Postgres-with-pgvector for the dev server, hosted on
the home tailnet k3s box. CI on GHA still uses ephemeral postgres
per workflow run; local-test path (`scripts/ci-local.sh`) still
uses local WSL postgres. **This deployment serves only the dev
server's `npm run dev` workflow.**

## Why

Local WSL2 NAT networking has been intermittently unreachable
across four sessions. Both `localhost:5434` (Windows-side) and the
WSL bridge IP (`172.x.y.z:5434`) drop sustained connections; the
dev server's postgres-js pool times out within minutes.

Mirrored networking via `~/.wslconfig` was tried earlier and
reverted (see comment in that file). The proper fix is to put the
DB somewhere the laptop can reach reliably — Dalekdefender is
already on the tailnet, already runs k3s, already hosts VH Health
+ Khata.

## Layout

| Resource | Value |
|---|---|
| Namespace | `reincarnated` |
| Secret | `reincarnated-postgres-creds` (POSTGRES_PASSWORD) |
| PVC | `reincarnated-postgres-data` — 5Gi, `local-path` |
| Deployment | `reincarnated-postgres` — `pgvector/pgvector:pg16` |
| Service | `reincarnated-postgres` — NodePort `30435` |
| Tailscale serve | `dalekdefender.hippocampus-monitor.ts.net:5435` (TCP) |

Distinct from VH Health's `vhhealth-postgres-0` (pg17) and
Khata's `khata-postgres` so version + data are isolated.

## Bootstrap (one-time)

```bash
# On the host (already done if /infra/dalekdefender/applied.txt
# exists). Otherwise:
ssh dd 'mkdir -p ~/reincarnated-infra && \
        cd ~/reincarnated-infra && \
        rm -rf manifests && \
        cp -r /mnt/d/Dev/Projects/reincarnated-rpg/infra/dalekdefender/manifests . || true'

# Or scp the manifests up if the windows path isn't mounted:
scp -r infra/dalekdefender/manifests dd:~/reincarnated-infra/

# Generate + apply the secret (NEVER commit the actual password):
ssh dd 'sudo -n kubectl create namespace reincarnated 2>/dev/null || true
        PASS=$(openssl rand -hex 16)
        sudo -n kubectl -n reincarnated create secret generic reincarnated-postgres-creds \
          --from-literal=POSTGRES_PASSWORD="$PASS" \
          --dry-run=client -o yaml | sudo -n kubectl apply -f -
        echo "PASSWORD: $PASS"'

# Apply the rest:
ssh dd 'cd ~/reincarnated-infra/manifests && \
        sudo -n kubectl apply -f pvc.yaml && \
        sudo -n kubectl apply -f deployment.yaml && \
        sudo -n kubectl apply -f service.yaml && \
        sudo -n kubectl -n reincarnated rollout status deploy/reincarnated-postgres --timeout=120s'

# Expose via tailscale serve TCP:
ssh dd 'sudo -n tailscale serve --bg --tcp 5435 tcp://localhost:30435'

# Run migrations from the windows side (DATABASE_URL points at
# Dalek). See `npm run db:migrate` in package.json.

# Apply migrations directly via psql in the container:
ssh dd 'sudo -n kubectl -n reincarnated exec -i deploy/reincarnated-postgres -- bash -c "cd /tmp && find . -name 0*.sql"'
```

## Connection

```
DATABASE_URL=postgres://reincarnated:<password>@dalekdefender.hippocampus-monitor.ts.net:5435/reincarnated
```

The password is the one printed by the bootstrap step above. Save
it to your local `.env.local` only — never commit.

## Daily ops

| Task | Command |
|---|---|
| Shell into psql | `ssh dd 'sudo -n kubectl -n reincarnated exec -it deploy/reincarnated-postgres -- psql -U reincarnated -d reincarnated'` |
| Tail logs | `ssh dd 'sudo -n kubectl -n reincarnated logs -f deploy/reincarnated-postgres'` |
| Apply a single migration | `cat src/lib/db/migrations/0067_xxx.sql \| ssh dd 'sudo -n kubectl -n reincarnated exec -i deploy/reincarnated-postgres -- psql -U reincarnated -d reincarnated'` |
| Reset DB (DANGEROUS) | `ssh dd 'sudo -n kubectl -n reincarnated exec -it deploy/reincarnated-postgres -- psql -U reincarnated -d postgres -c "DROP DATABASE reincarnated; CREATE DATABASE reincarnated; \\c reincarnated; CREATE EXTENSION vector;"'` |
| Backup | `ssh dd 'sudo -n kubectl -n reincarnated exec deploy/reincarnated-postgres -- pg_dump -U reincarnated reincarnated' > backup.sql` |
| Restart pod | `ssh dd 'sudo -n kubectl -n reincarnated rollout restart deploy/reincarnated-postgres'` |

## What stays local

- **Tests** (`npm run ci:local`) still target `127.0.0.1:5434` for
  speed + isolation. Each run drops + recreates the
  `reincarnated_ci` database.
- **CI on GHA** (when not billing-blocked) uses an ephemeral
  postgres service per workflow.

This is intentional: the test path needs to TRUNCATE per test, and
doing that against a remote DB is slow + risky (a bug in test
isolation could nuke dev data). Local for tests, Dalek for dev.

## Failure modes

| Failure | Symptom | Recovery |
|---|---|---|
| Tailscale on this PC drops | `npm run dev` ECONNREFUSEs | Tray icon → reconnect |
| Dalek reboots | Same | Pod auto-restarts on k3s; check `kubectl get pods -n reincarnated` |
| Pod evicted / OOM | Same | Same — k3s replaces the pod |
| PVC corrupted | Schema queries error | Restore from `pg_dump` backup |
| Tailscale serve config lost | Connection refused at port 5435 | Re-run `tailscale serve --bg --tcp 5435 tcp://localhost:30435` |

## Removing the deployment (full cleanup)

```bash
ssh dd 'sudo -n tailscale serve --tcp 5435 off
        sudo -n kubectl delete namespace reincarnated'
```
