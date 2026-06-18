#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SECRETS_DIR="${ROOT_DIR}/deploy/secrets"
RUNTIME_ENV="${SECRETS_DIR}/runtime.env"
CREDENTIALS_FILE="${SECRETS_DIR}/initial-admin-credentials.txt"

if [[ -e "${RUNTIME_ENV}" ]]; then
  echo "Refusing to overwrite ${RUNTIME_ENV}. Remove it explicitly to rotate the local stack." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker access is required to generate the Caddy password hash." >&2
  echo "Add this user to the docker group, sign out/in, then retry." >&2
  exit 1
fi

mkdir -p "${SECRETS_DIR}" "${ROOT_DIR}/deploy/backups" "${ROOT_DIR}/runtime"
chmod 700 "${SECRETS_DIR}" "${ROOT_DIR}/deploy/backups"

random_hex() {
  openssl rand -hex "$1"
}

base64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

sign_jwt() {
  local role="$1"
  local secret="$2"
  local now expires header payload unsigned signature
  now="$(date +%s)"
  expires="$((now + 315360000))"
  header="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | base64url)"
  payload="$(printf '{"iss":"supabase-demo","role":"%s","iat":%s,"exp":%s}' "$role" "$now" "$expires" | base64url)"
  unsigned="${header}.${payload}"
  signature="$(printf '%s' "$unsigned" | openssl dgst -sha256 -mac HMAC -macopt "key:${secret}" -binary | base64url)"
  printf '%s.%s\n' "$unsigned" "$signature"
}

postgres_password="$(random_hex 32)"
jwt_secret="$(random_hex 48)"
anon_key="$(sign_jwt anon "$jwt_secret")"
service_role_key="$(sign_jwt service_role "$jwt_secret")"
admin_password="$(random_hex 16)"
grafana_password="$(random_hex 16)"
pg_meta_crypto_key="$(random_hex 32)"
admin_hash="$(docker run --rm caddy:2.10.0-alpine caddy hash-password --plaintext "$admin_password")"

cat > "${RUNTIME_ENV}" <<EOF
POSTGRES_PASSWORD=${postgres_password}
JWT_SECRET=${jwt_secret}
JWT_EXPIRY=3600
ANON_KEY=${anon_key}
SERVICE_ROLE_KEY=${service_role_key}
PG_META_CRYPTO_KEY=${pg_meta_crypto_key}
ADMIN_PASSWORD_HASH='${admin_hash}'
GRAFANA_ADMIN_PASSWORD=${grafana_password}

REDMINE_URL=https://maintenance.medianet.tn
REDMINE_API_KEY=CHANGE_ME_ROTATE_THE_EXPOSED_KEY
LOVABLE_API_KEY=CHANGE_ME_ROTATE_THE_EXPOSED_KEY
REDMINE_PAGE_SIZE=500
REDMINE_PROJECT_BATCH_SIZE=20
WAREHOUSE_REFRESH_SECONDS=300
INGEST_INTERVAL_SECONDS=300
BACKUP_DAILY_RETENTION=14
BACKUP_WEEKLY_RETENTION=8
EOF

cat > "${CREDENTIALS_FILE}" <<EOF
Temporary admin gateway
username: admin
password: ${admin_password}

Grafana
username: admin
password: ${grafana_password}
EOF

chmod 600 "${RUNTIME_ENV}" "${CREDENTIALS_FILE}"
echo "Generated ${RUNTIME_ENV}"
echo "Generated ${CREDENTIALS_FILE}"
echo "Edit REDMINE_API_KEY and LOVABLE_API_KEY with newly rotated values before deployment."
