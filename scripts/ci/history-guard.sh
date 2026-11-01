#!/usr/bin/env bash
# Scans what a change adds before it can reach a public remote.
#
#   1. Secrets: gitleaks with the repo's .gitleaks.toml over the new commits.
#   2. Fork-only names: when NAME_GUARD_REGEX is set (a CI secret, so the
#      names themselves never enter the repository), fails if any new
#      commit's content or message, or any tracked path or file, matches
#      it. Untracked and ignored files (node_modules, worktrees) are not
#      scanned, since they never reach a remote. Matches are reported redacted. Without the secret
#      (forks, upstream) this check is skipped.
#
# Usage: history-guard.sh <base-sha> <head-sha>
#   An empty or all-zero base scans the whole history of <head-sha>.
set -euo pipefail

base="${1:-}"
head="${2:-HEAD}"

if [ -z "$base" ] || [ "$base" = "0000000000000000000000000000000000000000" ]; then
  log_opts="$head"
  echo "Scanning all history of $head"
else
  log_opts="$base..$head"
  echo "Scanning $log_opts ($(git rev-list --count "$log_opts") commits)"
fi

echo "::group::Secrets (repo .gitleaks.toml)"
gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="$log_opts" .
echo "::endgroup::"

if [ -z "${NAME_GUARD_REGEX:-}" ]; then
  echo "NAME_GUARD_REGEX is not set; skipping the fork-only name check."
  exit 0
fi

case "$NAME_GUARD_REGEX" in
  *"'''"*) echo "NAME_GUARD_REGEX must not contain '''" >&2; exit 2 ;;
esac

# A standalone config: the repo allowlist exempts test files from secret
# rules, and those exemptions must not apply to this check.
config="$(mktemp)"
tree="$(mktemp -d)"
trap 'rm -rf "$config" "$tree"' EXIT
cat > "$config" <<EOF
title = "fork-only names"

[[rules]]
id = "fork-only-name"
description = "Content names something that must stay in the private fork"
regex = '''$NAME_GUARD_REGEX'''

[[rules]]
id = "fork-only-path"
description = "Path names something that must stay in the private fork"
path = '''$NAME_GUARD_REGEX'''
EOF

echo "::group::Fork-only names: new commits"
gitleaks git --no-banner --redact --config "$config" --log-opts="$log_opts" .
echo "::endgroup::"

echo "::group::Fork-only names: tracked files"
git checkout-index --all --prefix="$tree/"
gitleaks dir --no-banner --redact --config "$config" "$tree"
echo "::endgroup::"

echo "::group::Fork-only names: commit messages"
if git log --format=%B "$log_opts" \
  | perl -e 'my $re = qr/$ENV{NAME_GUARD_REGEX}/; while (<STDIN>) { exit 1 if /$re/ } exit 0'; then
  echo "No commit message matches."
else
  echo "A commit message in $log_opts matches NAME_GUARD_REGEX (text not shown)." >&2
  exit 1
fi
echo "::endgroup::"
