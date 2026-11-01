#!/bin/sh
# Restores a backup made by backup.sh into the production database.
# DESTRUCTIVE: replaces every table. Used for recovery and for a
# periodic restore drill into a scratch deployment.
#
#   ./restore.sh backups/assessors-studio-<stamp>.dump --yes
#
# The app is stopped during the restore and started again afterwards.
# The stack must run with the same secrets/master_encryption_key as the
# one that made the dump, or encrypted data stays unreadable.
set -eu

cd "$(dirname "$0")"
# Compose reads COMPOSE_FILE itself; set it (colon-separated) to include
# overlays, e.g. docker-compose.production.yml:docker-compose.proxy.yml
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
dump="${1:-}"
confirm="${2:-}"

if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "usage: $0 <backup.dump> --yes" >&2
  exit 2
fi
if [ "$confirm" != "--yes" ]; then
  echo "refusing: this replaces the database. Re-run with --yes." >&2
  exit 2
fi

if [ -f "$dump.sha256" ]; then
  if command -v sha256sum > /dev/null; then
    (cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256")
  else
    (cd "$(dirname "$dump")" && shasum -a 256 -c "$(basename "$dump").sha256")
  fi
fi

docker compose stop app
docker compose exec -T db \
  pg_restore -U assessors_studio -d assessors_studio --clean --if-exists --no-owner --single-transaction < "$dump"
docker compose start app
echo "restored: $dump"
