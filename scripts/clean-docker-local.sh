#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE=()
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "ERROR: Docker Compose is not available (docker compose or docker-compose)." >&2
  exit 1
fi

echo "Stopping compose stack and removing local volumes..."
"${COMPOSE[@]}" down --remove-orphans -v || true

echo "Pruning dangling images and build cache..."
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f >/dev/null 2>&1 || true

if [[ "${LOCAL_UP_DOCKER_PRUNE_ALL:-0}" == "1" ]]; then
  echo "Pruning all unused Docker data (including volumes)..."
  docker system prune -af --volumes
fi

echo "Docker cleanup complete."
