#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.production.yml"
ENV_FILE="${ROOT_DIR}/deploy/secrets/runtime.env"

cd "${ROOT_DIR}"

if ! docker info >/dev/null 2>&1; then
  echo "The current user cannot access Docker." >&2
  echo "Run: sudo usermod -aG docker \$USER, then sign out and back in." >&2
  exit 1
fi
if command -v systemctl >/dev/null 2>&1 && ! systemctl is-enabled docker >/dev/null 2>&1; then
  echo "WARNING: Docker is not enabled at boot." >&2
  echo "Run once as an administrator: sudo systemctl enable --now docker" >&2
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  "${ROOT_DIR}/deploy/scripts/init-secrets.sh"
fi
if grep -q 'CHANGE_ME_ROTATE_THE_EXPOSED_KEY' "${ENV_FILE}"; then
  echo "Rotate and set REDMINE_API_KEY and LOVABLE_API_KEY in ${ENV_FILE} first." >&2
  exit 1
fi

mkdir -p runtime deploy/backups
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" config --quiet
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --build --remove-orphans
"${ROOT_DIR}/deploy/scripts/smoke-test.sh" --local

echo "Deployment started. Waiting for the Quick Tunnel URL..."
for _ in $(seq 1 60); do
  if [[ -s runtime/quick-tunnel-url.txt ]]; then
    printf 'Public URL: %s\n' "$(cat runtime/quick-tunnel-url.txt)"
    printf 'Studio: %s/admin/studio\n' "$(cat runtime/quick-tunnel-url.txt)"
    printf 'Grafana: %s/admin/grafana/\n' "$(cat runtime/quick-tunnel-url.txt)"
    exit 0
  fi
  sleep 2
done

echo "Stack is running, but the Quick Tunnel URL is not ready yet." >&2
echo "Run deploy/scripts/status.sh to inspect it." >&2
