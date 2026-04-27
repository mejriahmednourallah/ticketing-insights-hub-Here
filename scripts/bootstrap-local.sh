#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
ENV_EXAMPLE_FILE="${ROOT_DIR}/.env.example"
SUPABASE_INSTALLER="${ROOT_DIR}/install-supabase-cli.sh"

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

escape_env_value() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
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

is_placeholder() {
  local value="${1:-}"
  [[ -z "${value}" || "${value}" == "replace_me" || "${value}" == "your_key_here" || "${value}" == "changeme" ]]
}

if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${ENV_EXAMPLE_FILE}" ]]; then
    cp "${ENV_EXAMPLE_FILE}" "${ENV_FILE}"
    log "Created .env from .env.example."
  else
    die "Missing .env and .env.example files."
  fi
fi

if ! command -v supabase >/dev/null 2>&1; then
  if [[ -f "${SUPABASE_INSTALLER}" ]]; then
    log "Supabase CLI not found. Installing automatically..."
    bash "${SUPABASE_INSTALLER}"
    export PATH="${HOME}/.local/bin:${PATH}"
  else
    die "Supabase CLI not found and installer is missing: ${SUPABASE_INSTALLER}"
  fi
fi

require_command supabase
require_command docker

if ! docker info >/dev/null 2>&1; then
  die "Docker daemon is not running. Start Docker and try again."
fi

cd "${ROOT_DIR}"

load_env_file "${ENV_FILE}"

REDMINE_READY=1
if is_placeholder "${REDMINE_URL:-}" || is_placeholder "${REDMINE_API_KEY:-}"; then
  REDMINE_READY=0
  log "REDMINE_URL or REDMINE_API_KEY is missing/placeholder."
  log "Continuing in demo mode (Supabase + app only, ingestion skipped)."
fi

log "Starting local Supabase stack (Docker images may be pulled on first run)..."
if ! supabase start; then
  log "Supabase start failed. Trying a local stop/start recovery..."
  supabase stop --local >/dev/null 2>&1 || true
  if ! supabase start; then
    die "Unable to start local Supabase. Run: bash scripts/repair-supabase-local.sh"
  fi
fi

log "Reading local Supabase runtime credentials..."
STATUS_ENV="$(supabase status --local -o env)"
eval "${STATUS_ENV}"

if [[ -z "${API_URL:-}" || -z "${ANON_KEY:-}" || -z "${SERVICE_ROLE_KEY:-}" ]]; then
  die "Unable to read local Supabase keys from supabase status -o env"
fi

cat > "${ROOT_DIR}/.env.local.runtime" <<EOF
SUPABASE_URL=${API_URL}
SUPABASE_FUNCTIONS_URL=${API_URL}/functions/v1
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
VITE_SUPABASE_URL=${API_URL}
VITE_SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}
EOF

log "Generated .env.local.runtime with local Supabase URLs and keys."

log "Applying DB migrations..."
if ! supabase db push --local; then
  die "Failed to apply local migrations with 'supabase db push --local'."
fi

FUNCTION_ENV_FILE="${ROOT_DIR}/.env.local.functions"
cat > "${FUNCTION_ENV_FILE}" <<EOF
REDMINE_URL="$(escape_env_value "${REDMINE_URL:-}")"
REDMINE_API_KEY="$(escape_env_value "${REDMINE_API_KEY:-}")"
REDMINE_PAGE_SIZE="$(escape_env_value "${REDMINE_PAGE_SIZE:-100}")"
REDMINE_PROJECT_BATCH_SIZE="$(escape_env_value "${REDMINE_PROJECT_BATCH_SIZE:-20}")"
INGEST_SUPABASE_URL="$(escape_env_value "${API_URL}")"
INGEST_SUPABASE_SERVICE_ROLE_KEY="$(escape_env_value "${SERVICE_ROLE_KEY}")"
REDMINE_FIELD_TEAM="$(escape_env_value "${REDMINE_FIELD_TEAM:-}")"
REDMINE_FIELD_TECHNOLOGY="$(escape_env_value "${REDMINE_FIELD_TECHNOLOGY:-}")"
REDMINE_FIELD_TYPE="$(escape_env_value "${REDMINE_FIELD_TYPE:-}")"
REDMINE_FIELD_SATISFACTION="$(escape_env_value "${REDMINE_FIELD_SATISFACTION:-}")"
REDMINE_FIELD_SOURCE="$(escape_env_value "${REDMINE_FIELD_SOURCE:-}")"
REDMINE_FIELD_CANAL="$(escape_env_value "${REDMINE_FIELD_CANAL:-}")"
REDMINE_FIELD_SEGMENT_CLIENT="$(escape_env_value "${REDMINE_FIELD_SEGMENT_CLIENT:-}")"
REDMINE_FIELD_REGION="$(escape_env_value "${REDMINE_FIELD_REGION:-}")"
REDMINE_FIELD_REOPENED="$(escape_env_value "${REDMINE_FIELD_REOPENED:-}")"
REDMINE_FIELD_SLA_PLAN="$(escape_env_value "${REDMINE_FIELD_SLA_PLAN:-}")"
EOF

log "Generated .env.local.functions for local Edge Function runtime."

log "Local bootstrap complete."
if [[ "${REDMINE_READY}" == "1" ]]; then
  log "local-up will start redmine-ingest locally and trigger an initial sync."
else
  log "You can use CSV fallback immediately. Configure Redmine creds later to enable ingestion."
fi
log "Cron job redmine_ingest_every_5m is created by migrations."
