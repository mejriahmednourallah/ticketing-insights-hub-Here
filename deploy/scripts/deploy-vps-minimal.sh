#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.cloud-min.yml"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/deploy/secrets/cloud-min.env}"
DOMAIN="${TICKETING_DOMAIN:-ticketing.medianet.space}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-ticketing-cloud-min}"
INSTALL_APACHE_VHOST=0

for arg in "$@"; do
  case "${arg}" in
    --install-apache-vhost)
      INSTALL_APACHE_VHOST=1
      ;;
    --env-file=*)
      ENV_FILE="${arg#--env-file=}"
      ;;
    *)
      echo "Unknown argument: ${arg}" >&2
      exit 2
      ;;
  esac
done

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

retry() {
  local description="$1"
  shift
  for _ in $(seq 1 30); do
    if "$@" >/dev/null 2>&1; then
      echo "[OK] ${description}"
      return 0
    fi
    sleep 2
  done
  echo "[FAIL] ${description}" >&2
  return 1
}

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  echo "Create it from deploy/cloud-min.env.example or pass --env-file=/path/to/file." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

require_env VITE_SUPABASE_URL
require_env VITE_SUPABASE_PUBLISHABLE_KEY
require_env SUPABASE_ANON_KEY
require_env DBT_SUPABASE_HOST
require_env DBT_SUPABASE_PASSWORD

cd "${ROOT_DIR}"

docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" config --quiet
docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" up -d --build

ports="$(docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" ps | tail -n +2 || true)"
if printf '%s\n' "${ports}" | grep -E '0\.0\.0\.0|\[::\]' >/dev/null; then
  echo "A ticketing container is exposed publicly. Expected only 127.0.0.1 bindings." >&2
  docker compose --env-file "${ENV_FILE}" -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" ps
  exit 1
fi

retry "web health" curl --fail --silent http://127.0.0.1:18081/healthz
retry "analytics health" curl --fail --silent \
  --header "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  http://127.0.0.1:18082/v1/health

if [[ "${INSTALL_APACHE_VHOST}" -eq 1 ]]; then
  tmp_vhost="$(mktemp)"
  cat > "${tmp_vhost}" <<EOF
<VirtualHost *:80>
    ServerName ${DOMAIN}

    ProxyPreserveHost On
    ProxyRequests Off

    ProxyPass        /api/analytics/ http://127.0.0.1:18082/
    ProxyPassReverse /api/analytics/ http://127.0.0.1:18082/

    ProxyPass        / http://127.0.0.1:18081/
    ProxyPassReverse / http://127.0.0.1:18081/

    ErrorLog \${APACHE_LOG_DIR}/ticketing-error.log
    CustomLog \${APACHE_LOG_DIR}/ticketing-access.log combined
</VirtualHost>
EOF
  sudo install -m 0644 "${tmp_vhost}" "/etc/apache2/sites-available/${DOMAIN}.conf"
  rm -f "${tmp_vhost}"
  sudo a2enmod proxy proxy_http headers rewrite
  sudo a2ensite "${DOMAIN}.conf"
  sudo apache2ctl configtest
  sudo systemctl reload apache2
  echo "[OK] Apache vhost installed for ${DOMAIN}"
else
  cat <<EOF

Apache vhost was not installed. To install it, rerun:
  ./deploy/scripts/deploy-vps-minimal.sh --install-apache-vhost

Vhost to install manually:
<VirtualHost *:80>
    ServerName ${DOMAIN}
    ProxyPreserveHost On
    ProxyRequests Off
    ProxyPass        /api/analytics/ http://127.0.0.1:18082/
    ProxyPassReverse /api/analytics/ http://127.0.0.1:18082/
    ProxyPass        / http://127.0.0.1:18081/
    ProxyPassReverse / http://127.0.0.1:18081/
    ErrorLog \${APACHE_LOG_DIR}/ticketing-error.log
    CustomLog \${APACHE_LOG_DIR}/ticketing-access.log combined
</VirtualHost>
EOF
fi

echo "[OK] Minimal ticketing stack is running on 127.0.0.1:18081 and 127.0.0.1:18082"
