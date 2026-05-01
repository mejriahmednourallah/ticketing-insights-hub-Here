#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

LOCAL_UP_CLEAN_DOCKER=1 \
LOCAL_UP_ALLOW_SYNC_FAILURE="${LOCAL_UP_ALLOW_SYNC_FAILURE:-1}" \
LOCAL_UP_DETACHED=1 \
bash "${ROOT_DIR}/scripts/local-up.sh"

bash "${ROOT_DIR}/scripts/local-verify.sh"
