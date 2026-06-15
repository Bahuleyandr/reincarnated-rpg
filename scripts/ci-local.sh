#!/usr/bin/env bash
# scripts/ci-local.sh — local equivalent of .github/workflows/ci.yml
#
# Why this script exists: GitHub-hosted CI is currently billing-blocked
# on this account, so red checks on PRs are not a code signal. This
# script runs the same jobs the GHA workflow runs, in the same
# order, against the same inputs, so we can verify a branch locally
# before merging.
#
# Coverage map vs. .github/workflows/ci.yml
# -----------------------------------------
# content:validate   ✓  npm run content:validate
# test:risk          ✓  npm run test:risk
# lint               ✓  npm run lint
# typecheck          ✓  npm run typecheck
# test:unit          ✓  npm run test:unit
# db:migrate         ✓  npm run db:migrate (against the DATABASE_URL DB)
# db:seed            ✓  npm run db:seed
# test:integration   ◐  Run inside WSL Ubuntu — see "Why WSL" below.
# build              ✓  npm run build
# audit              ✓  npm audit --omit=dev --audit-level=high
#
# Why WSL for test:integration
# ----------------------------
# Postgres lives in a Docker container inside WSL Ubuntu-24.04.
# Default WSL2 NAT networking forwards the published port to
# 127.0.0.1:5434 on Windows, but sustained TCP streams (jest's
# integration suite holds connections open for 1–3 min per suite via
# postgres-js's pool) get dropped by the bridge. Connections from
# inside the same WSL distro hit localhost:5434 directly and are
# stable.
#
# The script handles this by invoking jest from WSL for the integration
# leg, with `npm rebuild --platform=linux esbuild` already done once
# (the Windows-side esbuild stays as the fallback at runtime via
# @esbuild/<platform> resolution).
#
# Usage
# -----
#   scripts/ci-local.sh                 # run every job
#   scripts/ci-local.sh --fast          # skip db/integration/build (content + risk + unit + lint + typecheck + audit only; ~15s)
#   scripts/ci-local.sh --skip-integration   # skip integration leg (no WSL)
#   scripts/ci-local.sh --only <job>    # run one job by id
#   scripts/ci-local.sh --help          # this banner
#
# Exit codes
# ----------
#   0  all requested jobs passed
#   1  at least one job failed
#   2  user-facing setup problem (missing tool / DB unreachable)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Colours — respect NO_COLOR and skip when stdout isn't a TTY.
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
    C_RED=; C_GREEN=; C_YELLOW=; C_BLUE=; C_DIM=; C_RESET=
fi

# --- Arg parsing ---
FAST=0
SKIP_INTEGRATION=0
ONLY=""
while (( $# )); do
    case "$1" in
        --fast)              FAST=1; shift ;;
        --skip-integration)  SKIP_INTEGRATION=1; shift ;;
        --only)
            shift
            if [[ $# -eq 0 ]]; then
                echo "${C_RED}error:${C_RESET} --only requires a job name" >&2
                exit 2
            fi
            ONLY="$1"
            shift
            ;;
        --only=*)            ONLY="${1#*=}"; shift ;;
        -h|--help)
            grep '^# ' "$0" | head -45 | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "${C_RED}error:${C_RESET} unknown flag '$1' (try --help)" >&2
            exit 2
            ;;
    esac
done

# --- Result accounting. Each job appends one line "status\tname\tdetail";
# the final summary prints a compact table.
RESULTS=()
JOB_DETAIL=""
JOB_SKIP_RC=3

start_job() {
    local id="$1" desc="$2"
    printf "%s==>%s %s %s%s%s\n" "$C_BLUE" "$C_RESET" "$desc" "$C_DIM" "[$id]" "$C_RESET"
}

record() {
    RESULTS+=("$1"$'\t'"$2"$'\t'"$3")
}

skip_job() {
    JOB_DETAIL="$1"
    echo "${C_DIM}  ↷ $1${C_RESET}"
    return "$JOB_SKIP_RC"
}

should_run() {
    local id="$1"
    if [[ -n "$ONLY" ]]; then
        [[ "$ONLY" == "$id" ]]
        return
    fi
    if [[ "$FAST" -eq 1 ]]; then
        case "$id" in
            content|risk|lint|typecheck|unit|audit) return 0 ;;
            *) return 1 ;;
        esac
    fi
    if [[ "$SKIP_INTEGRATION" -eq 1 && ( "$id" == "migrate" || "$id" == "seed" || "$id" == "integration" ) ]]; then
        return 1
    fi
    return 0
}

run_job() {
    local id="$1" desc="$2"
    shift 2
    if ! should_run "$id"; then
        record skip "$id" "filtered by flags"
        return 0
    fi
    start_job "$id" "$desc"
    local start end elapsed status rc detail
    JOB_DETAIL=""
    start=$(date +%s)
    if "$@"; then
        status=ok
    else
        rc=$?
        if [[ "$rc" -eq "$JOB_SKIP_RC" ]]; then
            status=skip
        else
            status=fail
        fi
    fi
    end=$(date +%s)
    elapsed=$((end - start))
    detail="${JOB_DETAIL:-${elapsed}s}"
    record "$status" "$id" "$detail"
    if [[ "$status" == "fail" ]]; then
        echo "${C_RED}  ✗ job '$id' failed after ${elapsed}s${C_RESET}"
    fi
}

# DATABASE_URL strategy: ci-local.sh uses a dedicated `reincarnated_ci`
# database that gets dropped + recreated at the start of every run.
# This mirrors GHA exactly — `.github/workflows/ci.yml` uses
# `reincarnated_test` against a fresh container — and avoids touching
# the dev DB (which accumulates state and is not safe to wipe).
#
# We default to localhost:5434 (matches docker-compose port mapping
# for the WSL-side container). The migrate/seed steps probe and fall
# back to the WSL bridge IP if Windows can't route to localhost. The
# integration step runs from inside WSL where localhost works
# directly (no bridge needed).
DEFAULT_DB_HOST="${DB_HOST:-127.0.0.1}"
DEFAULT_DB_PORT="${DB_PORT:-5434}"
DB_NAME="reincarnated_ci"
DB_USER="reincarnated"
DB_PASS="reincarnated"
WSL_DISTRO="${WSL_DISTRO:-Ubuntu-24.04}"

CI_DATABASE_URL="postgres://${DB_USER}:${DB_PASS}@${DEFAULT_DB_HOST}:${DEFAULT_DB_PORT}/${DB_NAME}"
export DATABASE_URL="$CI_DATABASE_URL"

# --- (re)create the CI database via docker exec inside WSL. CI does
# this implicitly because the postgres service is fresh per workflow;
# locally we drop+recreate the named DB so each ci-local run starts
# from a known state.
recreate_ci_db() {
    if ! command -v wsl.exe >/dev/null 2>&1; then
        echo "${C_RED}  cannot recreate CI DB: 'wsl' isn't on PATH.${C_RESET}"
        return 1
    fi
    # Wait for the container to be reachable inside WSL — local
    # `docker exec` is the most reliable path even if the Windows-
    # side network bridge is flaky.
    local attempts=0
    while (( attempts < 15 )); do
        if wsl.exe -d "$WSL_DISTRO" -e bash -c "docker ps --filter name=reincarnated-pg --filter health=healthy --format '{{.Names}}' | grep -q reincarnated-pg" 2>/dev/null; then
            break
        fi
        attempts=$((attempts + 1))
        sleep 2
    done
    if (( attempts >= 15 )); then
        echo "${C_RED}  reincarnated-pg container not healthy in WSL.${C_RESET}"
        echo "  Bring it up with: bash scripts/dev-up.sh"
        return 1
    fi
    wsl.exe -d "$WSL_DISTRO" -e bash -c "
        docker exec reincarnated-pg psql -U $DB_USER -d postgres -c 'DROP DATABASE IF EXISTS $DB_NAME' >/dev/null 2>&1
        docker exec reincarnated-pg psql -U $DB_USER -d postgres -c 'CREATE DATABASE $DB_NAME' >/dev/null 2>&1
        docker exec reincarnated-pg psql -U $DB_USER -d $DB_NAME -c 'CREATE EXTENSION IF NOT EXISTS vector' >/dev/null 2>&1
    "
}

# Wait for Postgres to be reachable. WSL2 NAT means the container can
# be "Up" but not yet listening on the published port for ~5-10 s after
# a fresh WSL boot. We retry the probe in case the distro just woke up.
#
# If localhost:5434 is unreachable, fall back to the WSL distro's
# bridge IP — Windows can't always route to localhost in NAT mode but
# the bridge IP works for short-lived queries (drizzle-kit migrate +
# seed). The integration leg is unaffected because it runs from
# inside the distro.
ensure_db_reachable() {
    local max_attempts=10
    local attempt=0
    local probe_rc
    while (( attempt < max_attempts )); do
        npx --no-install tsx scripts/check-test-db.ts >/dev/null 2>&1
        probe_rc=$?
        if (( probe_rc == 0 )); then
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 2
    done

    # Fall back to WSL bridge IP.
    if ! command -v wsl.exe >/dev/null 2>&1; then
        echo "${C_RED}  Postgres unreachable at $DATABASE_URL and 'wsl' isn't on PATH.${C_RESET}"
        echo "  Start the dev DB with: bash scripts/dev-up.sh"
        return 1
    fi
    local wsl_ip
    wsl_ip="$(wsl.exe -d "${WSL_DISTRO:-Ubuntu-24.04}" -e bash -c 'hostname -I' 2>/dev/null | awk '{print $1}' | tr -d '\r')"
    if [[ -z "$wsl_ip" ]]; then
        echo "${C_RED}  Postgres unreachable and could not resolve WSL distro IP.${C_RESET}"
        echo "  Start the dev DB with: bash scripts/dev-up.sh"
        return 1
    fi
    local rewritten
    rewritten="$(printf '%s\n' "$DATABASE_URL" | sed -E "s#@[^:/]+#@$wsl_ip#")"
    if [[ "$rewritten" != "$DATABASE_URL" ]]; then
        echo "${C_DIM}  retrying via WSL IP ($wsl_ip)${C_RESET}"
        export DATABASE_URL="$rewritten"
        attempt=0
        while (( attempt < max_attempts )); do
            npx --no-install tsx scripts/check-test-db.ts >/dev/null 2>&1
            probe_rc=$?
            if (( probe_rc == 0 )); then
                return 0
            fi
            attempt=$((attempt + 1))
            sleep 2
        done
    fi
    echo "${C_RED}  Postgres still unreachable after retries.${C_RESET}"
    echo "  Start the dev DB with: bash scripts/dev-up.sh (in WSL)"
    return 1
}

# --- Jobs ------------------------------------------------------------

job_content()   { npm run content:validate; }
job_risk()      { npm run test:risk; }
job_lint()      { npm run lint; }
job_typecheck() { npm run typecheck; }
job_unit()      { npm run test:unit; }

job_migrate() {
    # Drop + recreate the CI database so drizzle-kit migrate sees a
    # clean slate (it can't apply migrations against a populated DB
    # that's missing the __drizzle_migrations tracker).
    if ! recreate_ci_db; then
        return 1
    fi
    if ! ensure_db_reachable; then return 1; fi
    npm run db:migrate
}

job_seed() {
    if ! ensure_db_reachable; then return 1; fi
    npm run db:seed
}

# Integration tests run inside WSL Ubuntu — see "Why WSL" in the
# banner. Localhost in the WSL distro talks to docker-proxy in the
# same network namespace, so connections are stable for the entire
# 90–120s suite.
job_integration() {
    if ! command -v wsl.exe >/dev/null 2>&1; then
        echo "${C_YELLOW}  WSL not installed.${C_RESET}"
        echo "  Install once: wsl --install -d Ubuntu-24.04"
        skip_job "integration skipped: WSL not installed"
        return "$JOB_SKIP_RC"
    fi
    local distro="${WSL_DISTRO:-Ubuntu-24.04}"
    if ! wsl.exe -l -v 2>/dev/null | tr -d '\000' | grep -qi "$distro"; then
        echo "${C_YELLOW}  WSL distro '$distro' not installed.${C_RESET}"
        echo "  Install with: wsl --install -d $distro"
        skip_job "integration skipped: WSL distro '$distro' missing"
        return "$JOB_SKIP_RC"
    fi
    # The npm rebuild step is needed once after a fresh `npm ci` so
    # that the Linux-platform esbuild binary exists alongside the
    # Windows one. It's a no-op on subsequent runs.
    wsl.exe -d "$distro" -e bash -c "
        cd /mnt/d/Dev/Projects/reincarnated-rpg && \
        if [ ! -d node_modules/@esbuild/linux-x64 ]; then
            echo '  installing linux-platform esbuild for WSL leg…'
            npm rebuild --platform=linux esbuild >/dev/null 2>&1 || true
        fi && \
        DATABASE_URL='postgres://${DB_USER}:${DB_PASS}@127.0.0.1:${DEFAULT_DB_PORT}/${DB_NAME}' \
        SESSION_SECRET='ci-local-session-secret-pad-to-32-bytes' \
        NARRATOR=template EMBEDDINGS=mock NEXT_TELEMETRY_DISABLED=1 \
        npx jest --testPathPatterns=tests/integration --runInBand --testTimeout=15000
    "
}

job_build() { npm run build; }

# E2E smoke — POLISH_PLAN 0b.4. Boots `next start` against the
# already-built bundle on port 3100, then drives the happy-path
# Playwright spec. Skipped when Playwright browsers aren't
# installed (run `npx playwright install --with-deps chromium`
# locally once; CI installs on every run).
#
# Env hygiene: NODE_ENV=test stops Next from loading .env.local
# (which on this PC points at Dalek). The Next server inherits
# DATABASE_URL + SESSION_SECRET from the process env.
job_e2e() {
    if ! command -v npx >/dev/null 2>&1; then
        skip_job "e2e skipped: npx not on PATH"
        return "$JOB_SKIP_RC"
    fi
    local keepalive_pid=""
    local server_pid=""
    local distro="${WSL_DISTRO:-Ubuntu-24.04}"
    # Keep WSL awake while Windows-side `next start` talks to the
    # Docker Postgres port. Without a long-lived WSL process, the
    # distro can idle out between the DB probe and Playwright turn
    # submission, which silently stops the container mid-smoke.
    if command -v wsl.exe >/dev/null 2>&1 && wsl.exe -l -v 2>/dev/null | tr -d '\000' | grep -qi "$distro"; then
        wsl.exe -d "$distro" -e bash -lc "sleep 900" &
        keepalive_pid=$!
    fi
    cleanup_e2e() {
        if [[ -n "${server_pid:-}" ]]; then
            kill "$server_pid" 2>/dev/null || true
        fi
        if [[ -n "${keepalive_pid:-}" ]]; then
            kill "$keepalive_pid" 2>/dev/null || true
        fi
    }
    trap cleanup_e2e RETURN

    if ! ensure_db_reachable; then return 1; fi
    local e2e_database_url="$DATABASE_URL"
    # Browser must be installed. We don't auto-install here —
    # too slow + needs sudo on Linux. Soft-skip with a hint.
    if ! npx --yes playwright --version >/dev/null 2>&1; then
        skip_job "e2e skipped: install with 'npx playwright install --with-deps chromium'"
        return "$JOB_SKIP_RC"
    fi
    if [ ! -d ".next" ]; then
        echo "${C_YELLOW}  no .next build artifact; running 'next build' first${C_RESET}"
        if ! npm run build >/dev/null 2>&1; then
            return 1
        fi
    fi
    # Boot `next start` on a non-default port so a developer's
    # running `next dev` (port 3000) doesn't collide.
    local port=3100
    NODE_ENV=test \
    DATABASE_URL="$e2e_database_url" \
    SESSION_SECRET="ci-local-session-secret-pad-to-32-bytes" \
    NARRATOR=template EMBEDDINGS=mock NEXT_TELEMETRY_DISABLED=1 \
    npx --yes next start -p "$port" >/tmp/next-e2e.log 2>&1 &
    server_pid=$!
    # Wait up to 30s for the server to start serving.
    local ready=0
    for _ in {1..30}; do
        if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
            ready=1
            break
        fi
        sleep 1
    done
    if [ "$ready" -ne 1 ]; then
        echo "${C_RED}  next start never came up — see /tmp/next-e2e.log${C_RESET}"
        return 1
    fi
    # Run playwright against the running server (skip its built-in
    # webServer launcher via env, and override baseURL via env).
    PLAYWRIGHT_BASE_URL="http://127.0.0.1:$port" \
    PLAYWRIGHT_SKIP_WEBSERVER=1 \
    npx --yes playwright test --reporter=line
}

job_audit() {
    # `npm audit --audit-level=high` exits 0 when nothing is high-or-
    # worse and exits non-zero only on findings at the configured
    # level. Keep the full output visible so any new high vuln is
    # immediately readable.
    npm audit --omit=dev --audit-level=high
}

# --- Run the set ---
echo "${C_BLUE}reincarnated-rpg — local CI${C_RESET}  ($(date '+%Y-%m-%d %H:%M'))"
echo "${C_DIM}flags: fast=$FAST skip_integration=$SKIP_INTEGRATION only=${ONLY:-<all>}${C_RESET}"
echo "${C_DIM}DATABASE_URL: ${DATABASE_URL:-<unset>}${C_RESET}"
echo

run_job content     "Validate content/"           job_content
run_job risk        "Risk playtest harness"        job_risk
run_job lint        "ESLint"                       job_lint
run_job typecheck   "tsc --noEmit"                 job_typecheck
run_job unit        "Jest unit"                    job_unit
run_job migrate     "Drizzle migrate"              job_migrate
run_job seed        "Seed reference data"          job_seed
run_job integration "Jest integration (via WSL)"   job_integration
run_job build       "Next build"                   job_build
run_job e2e         "Playwright smoke (happy path)" job_e2e
run_job audit       "npm audit (high)"             job_audit

# --- Summary ---
echo
echo "${C_BLUE}Summary${C_RESET}"
printf "  %-8s  %-30s  %s\n" "STATUS" "JOB" "DURATION"
printf "  %-8s  %-30s  %s\n" "------" "---" "--------"
exit_code=0
for line in "${RESULTS[@]}"; do
    IFS=$'\t' read -r status id detail <<< "$line"
    case "$status" in
        ok)   printf "  %b%-8s%b  %-30s  %s\n" "$C_GREEN" "OK"   "$C_RESET" "$id" "$detail" ;;
        fail) printf "  %b%-8s%b  %-30s  %s\n" "$C_RED"   "FAIL" "$C_RESET" "$id" "$detail"; exit_code=1 ;;
        skip) printf "  %b%-8s%b  %-30s  %s\n" "$C_DIM"   "SKIP" "$C_RESET" "$id" "$detail" ;;
    esac
done

if [[ "$exit_code" -eq 0 ]]; then
    echo
    echo "${C_GREEN}✓ all requested jobs passed${C_RESET}"
else
    echo
    echo "${C_RED}✗ one or more jobs failed — see output above${C_RESET}"
fi
exit "$exit_code"
