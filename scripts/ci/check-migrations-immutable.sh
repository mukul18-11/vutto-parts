#!/usr/bin/env bash
# Fails if any file under supabase/migrations that existed at <base> was modified, renamed or
# deleted by HEAD. Applied migrations are immutable (CLAUDE.md rule 6); new files are allowed.
set -euo pipefail

base="${1:?usage: check-migrations-immutable.sh <base-commit>}"

if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  git fetch --no-tags --quiet origin "$base" || true
fi
if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "::error::Base commit $base is not available, so migration immutability cannot be checked."
  exit 1
fi

changed="$(git diff --name-status -M --diff-filter=DMRT "$base" HEAD -- supabase/migrations)"
if [ -n "$changed" ]; then
  echo "::error::Existing migrations were modified, renamed or deleted. Add a new migration instead."
  echo "$changed"
  exit 1
fi
echo "No existing migration changed since $base."
