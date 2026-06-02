#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"
export PATH="${HOME}/.local/bin:${PATH}"

REDMINE_SERVE_PID_FILE="${ROOT_DIR}/.redmine-ingest.pid"
REDMINE_SERVE_LOG_FILE="${ROOT_DIR}/.redmine-ingest.log"

is_placeholder() {
  local value="${1:-}"
  [[ -z "${value}" || "${value}" == "replace_me" || "${value}" == "your_key_here" || "${value}" == "changeme" ]]
}

load_env_file() {
  local file="$1"
  local line key value

  [[ -f "$file" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *"="* ]] && continue

    key="${line%%=*}"
    value="${line#*=}"

    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi

    if [[ ${#value} -ge 2 && "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ ${#value} -ge 2 && "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi

    export "$key=$value"
  done < "$file"
}

start_local_redmine_function() {
  local pid=""

  if ! command -v supabase >/dev/null 2>&1; then
    echo "ERROR: supabase command not found in PATH while starting local function runtime." >&2
    return 1
  fi

  if [[ -f "${REDMINE_SERVE_PID_FILE}" ]]; then
    pid="$(cat "${REDMINE_SERVE_PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      echo "Restarting existing redmine-ingest runtime (pid ${pid}) to refresh code/env..."
      kill "${pid}" >/dev/null 2>&1 || true

      for _ in $(seq 1 10); do
        if ! kill -0 "${pid}" >/dev/null 2>&1; then
          break
        fi
        sleep 1
      done

      if kill -0 "${pid}" >/dev/null 2>&1; then
        kill -9 "${pid}" >/dev/null 2>&1 || true
      fi
    fi
  fi

  echo "Starting redmine-ingest local runtime..."
  supabase functions serve redmine-ingest --env-file "${ROOT_DIR}/.env.local.functions" --no-verify-jwt >"${REDMINE_SERVE_LOG_FILE}" 2>&1 &
  pid="$!"
  echo "${pid}" > "${REDMINE_SERVE_PID_FILE}"

  for _ in $(seq 1 30); do
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "${SUPABASE_FUNCTIONS_URL%/}/redmine-ingest" || true)"
    if [[ "${code}" == "200" || "${code}" == "204" || "${code}" == "401" || "${code}" == "403" || "${code}" == "405" ]]; then
      return 0
    fi

    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      echo "ERROR: redmine-ingest runtime exited early. See ${REDMINE_SERVE_LOG_FILE}" >&2
      return 1
    fi

    sleep 1
  done

  echo "ERROR: redmine-ingest runtime did not become ready. See ${REDMINE_SERVE_LOG_FILE}" >&2
  return 1
}

trigger_initial_sync() {
  local url="$1"
  local token="$2"
  local attempts="${LOCAL_UP_INGEST_RETRIES:-6}"
  local delay="${LOCAL_UP_INGEST_RETRY_DELAY:-2}"
  local attempt code body_file attempts_used=0

  body_file="$(mktemp -t redmine-sync-body-XXXXXX)"

  for attempt in $(seq 1 "${attempts}"); do
    attempts_used="${attempt}"
    code="$(curl -sS -o "${body_file}" -w '%{http_code}' \
      -X POST "${url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -d '{"mode":"full"}' || true)"

    if [[ "${code}" =~ ^2 ]]; then
      cat "${body_file}"
      rm -f "${body_file}"
      return 0
    fi

    echo "Initial Redmine sync attempt ${attempt}/${attempts} failed with HTTP ${code}."
    if [[ -s "${body_file}" ]]; then
      cat "${body_file}"
      echo
    fi

    if [[ "${code}" == "502" || "${code}" == "503" || "${code}" == "504" ]]; then
      if [[ "${attempt}" -lt "${attempts}" ]]; then
        sleep "${delay}"
        delay=$((delay * 2))
        continue
      fi
    fi

    break
  done

  echo "ERROR: Initial Redmine sync failed after ${attempts_used} attempt(s)." >&2
  if [[ "${code}" == "403" ]]; then
    echo "Diagnostic: Redmine returned 403 Forbidden (API key invalid, permissions, or source IP blocked)." >&2
  fi
  if [[ -f "${REDMINE_SERVE_LOG_FILE}" ]]; then
    echo "Last function runtime logs:" >&2
    tail -n 60 "${REDMINE_SERVE_LOG_FILE}" >&2 || true
  fi

  rm -f "${body_file}"
  return 1
}

refresh_duckdb_warehouse() {
  if [[ "${LOCAL_UP_SKIP_DUCKDB:-0}" == "1" ]]; then
    echo "Skipping DuckDB warehouse refresh (LOCAL_UP_SKIP_DUCKDB=1)."
    return 0
  fi

  echo "Refreshing DuckDB warehouse from scratch..."
  rm -f "${ROOT_DIR}/ticketing_warehouse/warehouse.duckdb" \
        "${ROOT_DIR}/ticketing_warehouse/warehouse.duckdb.wal"

  npm run warehouse:duckdb:bootstrap
  npm run warehouse:duckdb:run
  npm run warehouse:duckdb:test
  npm run warehouse:duckdb:validate
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
    return
  fi
}

if [[ "${LOCAL_UP_CLEAN_DOCKER:-0}" == "1" ]]; then
  bash "${ROOT_DIR}/scripts/clean-docker-local.sh"
fi

COMPOSE=()
compose_cmd
if [[ "${#COMPOSE[@]}" -eq 0 ]]; then
  echo "ERROR: Docker Compose is not available (docker compose or docker-compose)." >&2
  exit 1
fi

bash "${ROOT_DIR}/scripts/bootstrap-local.sh"

if [[ ! -f "${ROOT_DIR}/.env.local.runtime" ]]; then
  echo "ERROR: Missing .env.local.runtime after bootstrap." >&2
  exit 1
fi

if [[ ! -f "${ROOT_DIR}/.env.local.web" ]]; then
  echo "ERROR: Missing .env.local.web after bootstrap." >&2
  exit 1
fi

load_env_file "${ROOT_DIR}/.env"
load_env_file "${ROOT_DIR}/.env.local.runtime"

if [[ "${LOCAL_UP_SKIP_INGEST:-0}" != "1" ]]; then
  if ! is_placeholder "${REDMINE_URL:-}" && ! is_placeholder "${REDMINE_API_KEY:-}"; then
    if ! command -v curl >/dev/null 2>&1; then
      echo "ERROR: curl is required to trigger initial Redmine sync." >&2
      exit 1
    fi

    if [[ -z "${SUPABASE_FUNCTIONS_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
      echo "ERROR: Missing SUPABASE_FUNCTIONS_URL or SUPABASE_SERVICE_ROLE_KEY for initial sync." >&2
      exit 1
    fi

    start_local_redmine_function

    SYNC_URL="${SUPABASE_FUNCTIONS_URL%/}/redmine-ingest"
    echo "Triggering initial Redmine sync..."
    if ! trigger_initial_sync "${SYNC_URL}" "${SUPABASE_SERVICE_ROLE_KEY}"; then
      if [[ "${LOCAL_UP_ALLOW_SYNC_FAILURE:-1}" == "1" ]]; then
        echo "WARNING: Initial Redmine sync failed. Continuing startup with current data source (CSV fallback available)." >&2
      else
        echo "ERROR: Initial Redmine sync failed and LOCAL_UP_ALLOW_SYNC_FAILURE=0." >&2
        exit 1
      fi
    fi
    echo
  else
    echo "Skipping initial Redmine sync (REDMINE_URL or REDMINE_API_KEY not configured)."
  fi
fi

refresh_duckdb_warehouse

if [[ "${LOCAL_UP_NO_WEB:-0}" == "1" ]]; then
  echo "Bootstrap done. Frontend startup skipped (LOCAL_UP_NO_WEB=1)."
  exit 0
fi

if [[ "${LOCAL_UP_DETACHED:-0}" == "1" ]]; then
  echo "Starting frontend in detached mode..."
  "${COMPOSE[@]}" up --build -d
  echo "App should be available at http://localhost:8080"
  exit 0
fi

echo "Starting frontend (attached mode)..."
exec "${COMPOSE[@]}" up --build
