#!/usr/bin/env bash
# Install Supabase CLI from official release binaries

set -e

SUPABASE_VERSION="1.190.0"
INSTALL_DIR="/usr/local/bin"

echo "🔧 Installing Supabase CLI v${SUPABASE_VERSION}..."

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Map architecture names
case "${ARCH}" in
  x86_64)
    ARCH="amd64"
    ;;
  aarch64)
    ARCH="arm64"
    ;;
  arm64)
    ARCH="arm64"
    ;;
esac

# Construct download URL
RELEASE_URL="https://github.com/supabase/cli/releases/download/v${SUPABASE_VERSION}/supabase_${SUPABASE_VERSION}_${OS}_${ARCH}.tar.gz"

echo "📥 Downloading from: ${RELEASE_URL}"
TEMP_DIR="/tmp/supabase-install-$$"
mkdir -p "${TEMP_DIR}"

cd "${TEMP_DIR}"
curl -L -o supabase.tar.gz "${RELEASE_URL}" || {
    echo "❌ Download failed. Check the URL:"
    echo "   ${RELEASE_URL}"
    rm -rf "${TEMP_DIR}"
    exit 1
}

echo "📦 Extracting..."
tar -xzf supabase.tar.gz

echo "⚙️  Installing to ${INSTALL_DIR}..."
if [[ -w "${INSTALL_DIR}" ]]; then
    mv supabase "${INSTALL_DIR}/"
else
    sudo mv supabase "${INSTALL_DIR}/"
fi

# Make it executable
chmod +x "${INSTALL_DIR}/supabase"

echo "🧹 Cleaning up..."
rm -rf "${TEMP_DIR}"

echo "✅ Installation complete!"
echo ""
supabase --version
echo ""
echo "Now run: ./SETUP_MANUAL.sh"
