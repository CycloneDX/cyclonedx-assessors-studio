#!/bin/sh
# Backs up the production database (security review E5).
#
#   ./backup.sh [backup-dir]          default: ./backups
#
# Writes a pg_dump custom-format file plus its SHA-256, then deletes
# backups older than RETENTION_DAYS (default 14). Evidence stored in the
# database (STORAGE_PROVIDER=database) is included; S3 evidence is not.
#
# The dump holds encrypted columns as ciphertext. Restoring it is only
# useful with the same master_encryption_key, which is NOT in the dump:
# back up secrets/master_encryption_key separately and keep it apart from
# the dumps.
#
# Schedule it, e.g. daily at 02:15 from cron:
#   15 2 * * * cd /opt/assessors-studio/deploy/docker && ./backup.sh >> backups/backup.log 2>&1
set -eu

cd "$(dirname "$0")"
# Compose reads COMPOSE_FILE itself; set it (colon-separated) to include
# overlays, e.g. docker-compose.production.yml:docker-compose.proxy.yml
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
dir="${1:-./backups}"

umask 077
mkdir -p "$dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$dir/assessors-studio-$stamp.dump"

docker compose exec -T db \
  pg_dump -U assessors_studio -d assessors_studio --format=custom --no-owner > "$out.partial"
# A dump that pg_restore cannot list is not a backup.
docker compose exec -T db pg_restore --list < "$out.partial" > /dev/null
mv "$out.partial" "$out"

if command -v sha256sum > /dev/null; then
  (cd "$dir" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256")
else
  (cd "$dir" && shasum -a 256 "$(basename "$out")" > "$(basename "$out").sha256")
fi

find "$dir" -name 'assessors-studio-*.dump*' -type f -mtime +"$RETENTION_DAYS" -exec rm -f {} +

echo "backup written: $out ($(wc -c < "$out" | tr -d ' ') bytes)"
