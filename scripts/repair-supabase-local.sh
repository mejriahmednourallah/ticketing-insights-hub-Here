#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

export PATH="${HOME}/.local/bin:${PATH}"

log() {
  printf '%s\n' "$1"
}

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "Missing required command: $1"
  fi
}

require_command docker
require_command supabase

if ! docker info >/dev/null 2>&1; then
  die "Docker daemon is not reachable. Start Docker first."
fi

log "[1/6] Stopping local Supabase stack if running..."
supabase stop --local >/dev/null 2>&1 || true

log "[2/6] Cleaning local compose resources..."
if [[ -f "${ROOT_DIR}/scripts/clean-docker-local.sh" ]]; then
  bash "${ROOT_DIR}/scripts/clean-docker-local.sh"
else
  docker system prune -f >/dev/null 2>&1 || true
fi

log "[3/6] Removing stale local Supabase temp state..."
rm -rf "${ROOT_DIR}/supabase/.temp" || true

log "[4/6] Starting local Supabase..."
if ! supabase start; then
  die "supabase start failed after cleanup."
fi

log "[5/6] Checking local Supabase status..."
if ! supabase status --local >/dev/null 2>&1; then
  die "supabase status --local failed after start."
fi

log "[6/6] Applying local migrations..."
if ! supabase db push --local; then
  die "supabase db push --local failed."
fi

log "Supabase local repair completed successfully."
log "You can retry full startup with: bash scripts/local-up.sh"
