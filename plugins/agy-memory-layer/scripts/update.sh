#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_NAME="agy-memory-layer"
AGY_PLUGINS_DIR="${HOME}/.gemini/antigravity-cli/plugins"
MEMORY_ROOT="${HOME}/.gemini/memory"

echo "🔄 Updating Antigravity CLI Plugin: ${PLUGIN_NAME}"
echo "--------------------------------------------------"

# 1. Ensure scripts are executable
chmod +x "${PLUGIN_ROOT}/scripts/"*.sh

# 2. Re-link plugin directory to Antigravity plugins directory
mkdir -p "$AGY_PLUGINS_DIR"
TARGET_LINK="${AGY_PLUGINS_DIR}/${PLUGIN_NAME}"

if [ -L "$TARGET_LINK" ] || [ -d "$TARGET_LINK" ]; then
  rm -rf "$TARGET_LINK"
fi

ln -sf "$PLUGIN_ROOT" "$TARGET_LINK"
echo "✓ Symlink refreshed at ${TARGET_LINK}"

# 3. Validate Hooks
echo "🔍 Validating hook contracts..."
echo '{"workspacePaths":["'$(pwd)'"]}' | "${PLUGIN_ROOT}/scripts/hook-inject-memory.sh" >/dev/null
echo '{"decision":"stop"}' | "${PLUGIN_ROOT}/scripts/hook-auto-commit.sh" >/dev/null
echo "✓ Hooks validated successfully."

# 4. Report status
echo "--------------------------------------------------"
echo "🎉 ${PLUGIN_NAME} updated successfully!"
echo "Your memory in ${MEMORY_ROOT} is safely preserved."
