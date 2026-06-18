#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
base_url="http://127.0.0.1:8080"
ENV_FILE="${ROOT_DIR}/deploy/secrets/runtime.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ "${1:-}" != "--local" && -s "${ROOT_DIR}/runtime/tunnel-url.txt" ]]; then
  base_url="$(cat "${ROOT_DIR}/runtime/tunnel-url.txt")"
elif [[ "${1:-}" != "--local" && -s "${ROOT_DIR}/runtime/quick-tunnel-url.txt" ]]; then
  base_url="$(cat "${ROOT_DIR}/runtime/quick-tunnel-url.txt")"
fi

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

retry "gateway health" curl --fail --silent "${base_url}/healthz"
retry "dashboard" curl --fail --silent "${base_url}/"
retry "analytics health" curl --fail --silent \
  --header "Authorization: Bearer ${ANON_KEY}" \
  "${base_url}/api/analytics/v1/health"

studio_status="$(curl --silent --output /dev/null --write-out '%{http_code}' "${base_url}/admin/studio")"
grafana_status="$(curl --silent --output /dev/null --write-out '%{http_code}' "${base_url}/admin/grafana/")"
[[ "${studio_status}" == "401" ]] || {
  echo "[FAIL] Studio must return 401 without gateway credentials; got ${studio_status}" >&2
  exit 1
}
[[ "${grafana_status}" == "401" ]] || {
  echo "[FAIL] Grafana must return 401 without gateway credentials; got ${grafana_status}" >&2
  exit 1
}
echo "[OK] admin routes require gateway authentication"
