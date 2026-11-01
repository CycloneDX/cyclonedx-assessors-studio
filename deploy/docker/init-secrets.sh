#!/bin/sh
# Creates the Compose secret files docker-compose.production.yml mounts.
# Generates the ones the app needs, leaves the optional ones empty, and
# never overwrites a file that already exists. Run once before the first
# `docker compose -f docker-compose.production.yml up -d`.
set -eu

dir="$(cd "$(dirname "$0")" && pwd)/secrets"
# The directory is private to the operator (700). The files themselves
# are 644 because Compose bind-mounts each file with its host owner and
# mode, and the app runs as uid 1001 inside the container; a 600 file
# owned by you would be unreadable there. Other host users still cannot
# reach the files through the 700 directory.
umask 022
mkdir -p "$dir"
chmod 700 "$dir"

# Hex keeps the values safe inside URLs and shell quoting.
gen() { openssl rand -hex "$1"; }

write() {
  name="$1"; value="$2"
  if [ -e "$dir/$name" ]; then
    echo "kept      $name"
  else
    printf '%s' "$value" > "$dir/$name"
    chmod 644 "$dir/$name"
    echo "created   $name"
  fi
}

write postgres_password      "$(gen 32)"
write master_encryption_key  "$(gen 32)"   # 64 hex chars = 256 bits
write jwt_secret             "$(gen 48)"
write setup_token            "$(gen 24)"
# Optional: fill these in when you enable SMTP, metrics or S3 storage.
write smtp_pass              ""
write metrics_token          ""
write s3_access_key_id       ""
write s3_secret_access_key   ""

echo
echo "Secrets are in $dir (directory mode 700)."
echo "Back up master_encryption_key: without it, encrypted data cannot be read."
echo "The setup wizard asks for the token in $dir/setup_token."
