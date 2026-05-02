#!/usr/bin/env bash
# Stops the dev Postgres container. Volume data persists.
# Use `wsl -e bash -c "cd ... && docker compose down -v"` to wipe data.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
WSL_REPO_PATH="/mnt/${REPO_ROOT,,}"
WSL_REPO_PATH="${WSL_REPO_PATH//\\//}"
WSL_REPO_PATH="${WSL_REPO_PATH//:/}"

echo "[dev:down] stopping Postgres..."
wsl -e bash -c "cd '$WSL_REPO_PATH' && docker compose stop"
echo "[dev:down] done."
