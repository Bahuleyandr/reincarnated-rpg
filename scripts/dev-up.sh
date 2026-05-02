#!/usr/bin/env bash
# Brings up the dev stack in one command, blocks until Ctrl-C, cleans up on exit.
#
# - WSL keepalive: a long-lived `sleep infinity` inside the distro so the
#   Docker container survives between dev sessions. Without this the WSL
#   distro can idle out and silently kill Postgres mid-test (we saw this
#   on Day 2/3 — see `tools_wsl_postgres_dev.md` in user-memory for the
#   diagnosis).
# - Postgres: `docker compose up -d` (idempotent — no-op if already up).
# - Health wait + WSL IP echo so .env.local DATABASE_URL stays valid.
#
# This script is the canonical entrypoint for local dev. Run in a dedicated
# terminal; in another, run `npm test`, `npm run db:seed`, `npm run dev`, etc.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
WSL_REPO_PATH="/mnt/${REPO_ROOT,,}"
WSL_REPO_PATH="${WSL_REPO_PATH//\\//}"
WSL_REPO_PATH="${WSL_REPO_PATH//:/}"

cleanup() {
  echo
  echo "[dev:up] tearing down..."
  if [[ -n "${KEEPALIVE_PID:-}" ]] && kill -0 "$KEEPALIVE_PID" 2>/dev/null; then
    kill "$KEEPALIVE_PID" 2>/dev/null || true
  fi
  echo "[dev:up] done. Postgres container left running (use 'npm run dev:down' to stop)."
}
trap cleanup EXIT INT TERM

echo "[dev:up] starting WSL keepalive..."
wsl -e bash -c "sleep infinity" &
KEEPALIVE_PID=$!

echo "[dev:up] starting Postgres (docker compose up -d)..."
wsl -e bash -c "cd '$WSL_REPO_PATH' && docker compose up -d"

echo "[dev:up] waiting for Postgres healthy..."
wsl -e bash -c "until docker exec reincarnated-pg pg_isready -U reincarnated -d reincarnated >/dev/null 2>&1; do sleep 1; done"

WSL_IP=$(wsl -e bash -c "hostname -I | awk '{print \$1}'" | tr -d '[:space:]')
EXPECTED_DB_URL="postgres://reincarnated:reincarnated@${WSL_IP}:5433/reincarnated"
ACTUAL_DB_URL=$(grep -E '^DATABASE_URL=' "$REPO_ROOT/.env.local" 2>/dev/null | cut -d= -f2- || echo "")

echo "[dev:up] WSL IP: $WSL_IP"
echo "[dev:up] expected DATABASE_URL: $EXPECTED_DB_URL"
if [[ "$ACTUAL_DB_URL" != "$EXPECTED_DB_URL" ]]; then
  echo "[dev:up] WARNING: .env.local DATABASE_URL is '$ACTUAL_DB_URL'"
  echo "[dev:up]          update it if connection errors appear."
fi
echo "[dev:up] ready. Ctrl-C to release keepalive (Postgres stays up)."
wait "$KEEPALIVE_PID"
