#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/deploy/secrets/runtime.env"
cd "${ROOT_DIR}"

if [[ -s runtime/tunnel-url.txt ]]; then
  compose_file="docker-compose.run-everything.yml"
else
  compose_file="docker-compose.production.yml"
fi

docker compose --env-file "${ENV_FILE}" -f "${compose_file}" ps
echo
if [[ -s runtime/tunnel-url.txt ]]; then
  url="$(cat runtime/tunnel-url.txt)"
  echo "Named tunnel URL: ${url}"
  echo "Studio:           ${url}/admin/studio"
  echo "Grafana:          ${url}/admin/grafana/"
elif [[ -s runtime/quick-tunnel-url.txt ]]; then
  url="$(cat runtime/quick-tunnel-url.txt)"
  echo "Public URL: ${url}"
  echo "Studio:    ${url}/admin/studio"
  echo "Grafana:   ${url}/admin/grafana/"
else
  echo "Tunnel URL not available yet."
fi
echo
echo "Gateway username: admin"
echo "Grafana username: admin"
echo "Admin credentials: deploy/secrets/initial-admin-credentials.txt"
echo "Backups: deploy/backups/"
