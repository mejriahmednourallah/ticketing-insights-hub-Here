#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/deploy/secrets/runtime.env"
cd "${ROOT_DIR}"

docker compose --env-file "${ENV_FILE}" -f docker-compose.production.yml down
