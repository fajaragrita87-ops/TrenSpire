#!/bin/sh
set -eu

TS="$(date -u +%Y%m%d_%H%M%S)"
OUT_DIR="${BACKUP_DIR:-/backup}"
INTERVAL="${BACKUP_INTERVAL_SEC:-86400}"

mkdir -p "$OUT_DIR"

require_env() {
  k="$1"
  v="$(eval "printf %s \"\${$k:-}\"")"
  if [ -z "$v" ]; then
    echo "missing env: $k" >&2
    exit 1
  fi
}

require_env PGHOST
require_env PGUSER
require_env PGPASSWORD
require_env PGDATABASE
require_env R2_BUCKET
require_env R2_PREFIX

while true; do
  TS="$(date -u +%Y%m%d_%H%M%S)"
  FILE="$OUT_DIR/trendspire_${TS}.dump"

  pg_dump -Fc -f "$FILE" "$PGDATABASE"

  rclone copy "$FILE" "r2:${R2_BUCKET}/${R2_PREFIX}/" --s3-no-check-bucket --stats-one-line --stats=0

  rm -f "$FILE"

  sleep "$INTERVAL"
done
