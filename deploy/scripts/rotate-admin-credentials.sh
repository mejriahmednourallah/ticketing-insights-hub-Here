#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/deploy/secrets/runtime.env"
CREDENTIALS_FILE="${ROOT_DIR}/deploy/secrets/initial-admin-credentials.txt"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.run-everything.yml"
GRAFANA_CONTAINER="ticketing-run-everything-grafana-1"

cd "${ROOT_DIR}"

[[ -f "${ENV_FILE}" ]] || {
  echo "Missing ${ENV_FILE}" >&2
  exit 1
}
command -v openssl >/dev/null 2>&1 || {
  echo "openssl is required" >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "Docker access is required" >&2
  exit 1
}

admin_password="$(openssl rand -hex 16)"
grafana_password="$(openssl rand -hex 16)"
admin_hash="$(docker run --rm caddy:2.10.0-alpine caddy hash-password --plaintext "${admin_password}")"
env_tmp="${ENV_FILE}.tmp"
credentials_tmp="${CREDENTIALS_FILE}.tmp"

while IFS= read -r line || [[ -n "${line}" ]]; do
  case "${line}" in
    ADMIN_PASSWORD_HASH=*)
      printf "ADMIN_PASSWORD_HASH='%s'\n" "${admin_hash}"
      ;;
    GRAFANA_ADMIN_PASSWORD=*)
      printf 'GRAFANA_ADMIN_PASSWORD=%s\n' "${grafana_password}"
      ;;
    *)
      printf '%s\n' "${line}"
      ;;
  esac
done < "${ENV_FILE}" > "${env_tmp}"

cat > "${credentials_tmp}" <<EOF
Temporary admin gateway
username: admin
password: ${admin_password}

Grafana
username: admin
password: ${grafana_password}
EOF

chmod 600 "${env_tmp}" "${credentials_tmp}"
mv "${env_tmp}" "${ENV_FILE}"
mv "${credentials_tmp}" "${CREDENTIALS_FILE}"

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --force-recreate --no-deps grafana
for _ in $(seq 1 60); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${GRAFANA_CONTAINER}" 2>/dev/null || true)"
  [[ "${status}" == "healthy" ]] && break
  sleep 2
done
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${GRAFANA_CONTAINER}")" == "healthy" ]] || {
  echo "Grafana did not become healthy after rotation" >&2
  exit 1
}

docker exec "${GRAFANA_CONTAINER}" /usr/share/grafana/bin/grafana cli \
  --homepath /usr/share/grafana \
  --config /etc/grafana/grafana.ini \
  admin reset-admin-password "${grafana_password}" >/dev/null
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --force-recreate --no-deps gateway

echo "Rotated gateway and Grafana credentials."
echo "Credentials file: deploy/secrets/initial-admin-credentials.txt"
