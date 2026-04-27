#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ok() { echo "[OK] $1"; }
warn() { echo "[WARN] $1"; }
fail() { echo "[FAIL] $1"; exit 1; }

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing command: $1"
  fi
}

require docker
require supabase
require curl

if [[ ! -f "${ROOT_DIR}/.env.local.runtime" ]]; then
  fail "Missing .env.local.runtime. Run bash scripts/local-up.sh first."
fi

# shellcheck disable=SC1091
source "${ROOT_DIR}/.env.local.runtime"

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_FUNCTIONS_URL:-}" ]]; then
  fail "SUPABASE_URL or SUPABASE_FUNCTIONS_URL missing in .env.local.runtime"
fi

if ! supabase status --local >/dev/null 2>&1; then
  fail "Supabase local is not running"
fi
ok "Supabase local is running"

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  fail "Docker Compose is not available"
fi

WEB_STATE="$(${COMPOSE[@]} ps --status running --services 2>/dev/null | grep -E '^web$' || true)"
if [[ -z "${WEB_STATE}" ]]; then
  warn "web service is not running (detached). If you ran attached mode, this is expected."
else
  ok "web service is running"
fi

WEB_CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/ || true)"
if [[ "${WEB_CODE}" =~ ^2|3 ]]; then
  ok "Frontend responds on http://127.0.0.1:8080 (HTTP ${WEB_CODE})"
else
  warn "Frontend did not return success code (HTTP ${WEB_CODE})"
fi

FUNC_CODE="$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "${SUPABASE_FUNCTIONS_URL%/}/redmine-ingest" || true)"
if [[ "${FUNC_CODE}" == "000" ]]; then
  warn "redmine-ingest function endpoint unreachable"
else
  ok "redmine-ingest endpoint reachable (HTTP ${FUNC_CODE})"
fi

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n1 || true)"
if [[ -z "${DB_CONTAINER}" ]]; then
  warn "Supabase DB container not found by name pattern supabase_db_*"
else
  check_table() {
    local table="$1"
    local present
    present="$(docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -tAc "select to_regclass('public.${table}') is not null;" | tr -d '[:space:]')"
    if [[ "${present}" == "t" ]]; then
      ok "Table public.${table} exists"
    else
      warn "Table public.${table} missing"
    fi
  }

  check_table redmine_projects
  check_table redmine_issues
  check_table sync_state
  check_table sync_runs

  VIEW_PRESENT="$(docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -tAc "select to_regclass('public.redmine_ticket_view') is not null;" | tr -d '[:space:]')"
  if [[ "${VIEW_PRESENT}" == "t" ]]; then
    ok "View public.redmine_ticket_view exists"
  else
    warn "View public.redmine_ticket_view missing"
  fi
fi

echo "Local verification completed."
