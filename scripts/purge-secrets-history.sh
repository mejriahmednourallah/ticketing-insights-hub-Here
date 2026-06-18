#!/usr/bin/env bash
set -euo pipefail

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "Install git-filter-repo before running this destructive history rewrite." >&2
  exit 1
fi

git status --short
read -r -p "Rewrite all Git history to remove tracked environment files? Type PURGE: " confirmation
[[ "${confirmation}" == "PURGE" ]] || exit 1

git filter-repo --force --invert-paths \
  --path .env \
  --path .env.local.functions \
  --path .env.local.runtime \
  --path .env.local.web

echo "History rewritten. Re-add the remote if git-filter-repo removed it, review, then force-push with lease."
