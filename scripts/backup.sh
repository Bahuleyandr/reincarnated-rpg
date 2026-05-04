#!/usr/bin/env bash
# scripts/backup.sh — Phase 8 Day 64.
#
# Nightly Postgres dump. Intended for cron at 03:00 UTC. Stores
# rotation-stamped dumps under $BACKUP_DIR (default /backups).
# Keeps the last 14 nightly dumps; older are pruned.
#
# Required env: DATABASE_URL. Optional: BACKUP_DIR.

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set" >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-/backups}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/reincarnated_$STAMP.sql.gz"

echo "[backup] dumping to $OUT"
pg_dump --no-owner --no-acl --format=plain "$DATABASE_URL" | gzip -9 > "$OUT"

# Rotate: keep the most recent 14.
ls -1t "$BACKUP_DIR"/reincarnated_*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -v

echo "[backup] done: $(ls -lh "$OUT" | awk '{print $5}')"
