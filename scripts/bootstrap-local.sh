#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing .env file. Copy .env.example to .env and fill credentials first."
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is required. Install it first: https://supabase.com/docs/guides/cli"
  exit 1
fi

cd "${ROOT_DIR}"

set -a
source "${ENV_FILE}"
set +a

echo "Starting local Supabase stack (Docker images will be pulled automatically if missing)..."
supabase start

echo "Reading local Supabase runtime credentials..."
STATUS_ENV="$(supabase status -o env)"
eval "${STATUS_ENV}"

if [[ -z "${API_URL:-}" || -z "${ANON_KEY:-}" || -z "${SERVICE_ROLE_KEY:-}" ]]; then
  echo "Unable to read local Supabase keys from supabase status -o env"
  exit 1
fi

cat > "${ROOT_DIR}/.env.local.runtime" <<EOF
SUPABASE_URL=${API_URL}
SUPABASE_FUNCTIONS_URL=${API_URL}/functions/v1
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
VITE_SUPABASE_URL=${API_URL}
VITE_SUPABASE_PUBLISHABLE_KEY=${ANON_KEY}
EOF

echo "Generated .env.local.runtime with local Supabase URLs and keys"

echo "Applying DB migrations..."
supabase db push

echo "Injecting function secrets from .env..."
supabase secrets set \
  REDMINE_URL="${REDMINE_URL}" \
  REDMINE_API_KEY="${REDMINE_API_KEY}" \
  REDMINE_PAGE_SIZE="${REDMINE_PAGE_SIZE:-100}" \
  SUPABASE_URL="${API_URL}" \
  SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY}" \
  REDMINE_FIELD_TEAM="${REDMINE_FIELD_TEAM:-}" \
  REDMINE_FIELD_TECHNOLOGY="${REDMINE_FIELD_TECHNOLOGY:-}" \
  REDMINE_FIELD_TYPE="${REDMINE_FIELD_TYPE:-}" \
  REDMINE_FIELD_SATISFACTION="${REDMINE_FIELD_SATISFACTION:-}" \
  REDMINE_FIELD_SOURCE="${REDMINE_FIELD_SOURCE:-}" \
  REDMINE_FIELD_CANAL="${REDMINE_FIELD_CANAL:-}" \
  REDMINE_FIELD_SEGMENT_CLIENT="${REDMINE_FIELD_SEGMENT_CLIENT:-}" \
  REDMINE_FIELD_REGION="${REDMINE_FIELD_REGION:-}" \
  REDMINE_FIELD_REOPENED="${REDMINE_FIELD_REOPENED:-}" \
  REDMINE_FIELD_SLA_PLAN="${REDMINE_FIELD_SLA_PLAN:-}"

echo "Deploying ingestion edge function..."
supabase functions deploy redmine-ingest --no-verify-jwt

echo "Local bootstrap complete. You can now trigger ingestion with:"
echo "source .env.local.runtime"
echo "bun run ingest:redmine:function"
echo "A Supabase cron job (redmine_ingest_every_5m) is now scheduled every 5 minutes."
