#!/usr/bin/env bash

set -euo pipefail

SUPABASE_VERSION="${SUPABASE_CLI_VERSION:-}"
FORCE_INSTALL="${FORCE_INSTALL_SUPABASE_CLI:-0}"
GITHUB_API_BASE="https://api.github.com/repos/supabase/cli/releases"

log() {
  printf '%s\n' "$1"
}

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "Missing required command: $1"
  fi
}

fetch_release_json() {
  local url="$1"
  curl -fsSL \
    -H "Accept: application/vnd.github+json" \
    -H "User-Agent: ticketing-insights-hub-bootstrap" \
    "$url"
}

extract_tag_name() {
  local json="$1"
  printf '%s' "$json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}

extract_asset_url() {
  local json="$1"
  local os="$2"
  local arch="$3"

  printf '%s' "$json" | tr '\n' ' ' \
    | grep -Eo 'https://[^" ]+supabase[^" ]+\.(tar\.gz|zip)' \
    | grep -E "${os}_${arch}\.(tar\.gz|zip)$" \
    | head -n1
}

download_asset() {
  local url="$1"
  local target="$2"
  curl -fsSL -o "$target" "$url"
}

if command -v supabase >/dev/null 2>&1 && [[ "${FORCE_INSTALL}" != "1" ]]; then
  log "Supabase CLI already installed: $(supabase --version)"
  exit 0
fi

require_command curl
require_command tar

OS_RAW="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH_RAW="$(uname -m)"

case "${OS_RAW}" in
  linux|darwin)
    OS="${OS_RAW}"
    ;;
  *)
    die "Unsupported OS: ${OS_RAW}"
    ;;
esac

case "${ARCH_RAW}" in
  x86_64|amd64)
    ARCH="amd64"
    ;;
  aarch64|arm64)
    ARCH="arm64"
    ;;
  *)
    die "Unsupported architecture: ${ARCH_RAW}"
    ;;
esac

RELEASE_JSON=""
TAG_NAME=""
ASSET_URL=""

if [[ -n "${SUPABASE_VERSION}" ]]; then
  TAG_NAME="v${SUPABASE_VERSION#v}"
  RELEASE_JSON="$(fetch_release_json "${GITHUB_API_BASE}/tags/${TAG_NAME}" || true)"
  if [[ -z "${RELEASE_JSON}" ]]; then
    log "Requested Supabase CLI ${TAG_NAME} not found via API, falling back to latest release."
    SUPABASE_VERSION=""
  fi
fi

if [[ -z "${SUPABASE_VERSION}" ]]; then
  RELEASE_JSON="$(fetch_release_json "${GITHUB_API_BASE}/latest" || true)"
  [[ -n "${RELEASE_JSON}" ]] || die "Unable to resolve latest Supabase CLI release from GitHub API."
  TAG_NAME="$(extract_tag_name "${RELEASE_JSON}")"
  [[ -n "${TAG_NAME}" ]] || die "Unable to read latest Supabase CLI tag from GitHub API response."
  SUPABASE_VERSION="${TAG_NAME#v}"
fi

ASSET_URL="$(extract_asset_url "${RELEASE_JSON}" "${OS}" "${ARCH}")"

if [[ -z "${ASSET_URL}" ]]; then
  CANDIDATE_URLS=(
    "https://github.com/supabase/cli/releases/download/${TAG_NAME}/supabase_${SUPABASE_VERSION}_${OS}_${ARCH}.tar.gz"
    "https://github.com/supabase/cli/releases/download/${TAG_NAME}/supabase_${OS}_${ARCH}.tar.gz"
    "https://github.com/supabase/cli/releases/download/${TAG_NAME}/supabase_${SUPABASE_VERSION}_${OS}_${ARCH}.zip"
    "https://github.com/supabase/cli/releases/download/${TAG_NAME}/supabase_${OS}_${ARCH}.zip"
  )

  for candidate in "${CANDIDATE_URLS[@]}"; do
    if curl -fsI "$candidate" >/dev/null 2>&1; then
      ASSET_URL="$candidate"
      break
    fi
  done
fi

[[ -n "${ASSET_URL}" ]] || die "Could not find a Supabase CLI asset for ${OS}/${ARCH} in ${TAG_NAME}."

TMP_DIR="$(mktemp -d -t supabase-install-XXXXXX)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

log "Downloading Supabase CLI ${TAG_NAME} (${OS}/${ARCH})..."
ARCHIVE_PATH="${TMP_DIR}/supabase.pkg"
download_asset "${ASSET_URL}" "${ARCHIVE_PATH}" || die "Failed to download ${ASSET_URL}"

case "${ASSET_URL}" in
  *.tar.gz)
    tar -xzf "${ARCHIVE_PATH}" -C "${TMP_DIR}"
    ;;
  *.zip)
    require_command unzip
    unzip -q "${ARCHIVE_PATH}" -d "${TMP_DIR}"
    ;;
  *)
    die "Unsupported asset type: ${ASSET_URL}"
    ;;
esac

[[ -f "${TMP_DIR}/supabase" ]] || die "Invalid archive: supabase binary not found"

TARGET_DIR=""
if [[ -w "/usr/local/bin" ]]; then
  TARGET_DIR="/usr/local/bin"
elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  TARGET_DIR="/usr/local/bin"
else
  TARGET_DIR="${HOME}/.local/bin"
  mkdir -p "${TARGET_DIR}"
fi

if [[ "${TARGET_DIR}" == "/usr/local/bin" && ! -w "/usr/local/bin" ]]; then
  sudo install -m 0755 "${TMP_DIR}/supabase" "${TARGET_DIR}/supabase"
else
  install -m 0755 "${TMP_DIR}/supabase" "${TARGET_DIR}/supabase"
fi

if ! command -v supabase >/dev/null 2>&1; then
  export PATH="${TARGET_DIR}:${PATH}"
fi

if ! command -v supabase >/dev/null 2>&1; then
  die "Supabase installed in ${TARGET_DIR} but not found in PATH. Add ${TARGET_DIR} to PATH."
fi

log "Supabase CLI installed: $(supabase --version)"

if [[ ":${PATH}:" != *":${TARGET_DIR}:"* ]]; then
  log "Tip: add ${TARGET_DIR} to PATH in your shell profile."
fi
