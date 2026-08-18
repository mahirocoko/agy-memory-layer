#!/usr/bin/env bash
set -e

PLUGIN_NAME="agy-memory-layer"
AGY_PLUGINS_DIR="${HOME}/.gemini/antigravity-cli/plugins"
TARGET_LINK="${AGY_PLUGINS_DIR}/${PLUGIN_NAME}"
LEGACY_LINK="${AGY_PLUGINS_DIR}/memfs"
MEMORY_ROOT="${HOME}/.gemini/memory"

echo "🗑️  Uninstalling Antigravity CLI Plugin: ${PLUGIN_NAME}"
echo "--------------------------------------------------"

# 1. Unregister via agy plugin CLI if available
if command -v agy >/dev/null 2>&1; then
  echo "🔌 Unregistering from agy CLI..."
  agy plugin uninstall "${PLUGIN_NAME}" 2>/dev/null || true
fi

# 2. Remove plugin links from AGY plugins directory
rm -rf "$TARGET_LINK" "$LEGACY_LINK"
echo "✓ Plugin removed from ${AGY_PLUGINS_DIR}"

# 3. Check memory repository
if [ "$1" = "--purge" ]; then
  echo "⚠️  Purge requested: Removing Git memory repository at ${MEMORY_ROOT}..."
  rm -rf "$MEMORY_ROOT"
  echo "✓ MemFS memory repository purged."
else
  echo "ℹ️  Git memory repository preserved at ${MEMORY_ROOT}."
  echo "   (To delete memory completely, re-run with: $0 --purge)"
fi

echo "--------------------------------------------------"
echo "✓ ${PLUGIN_NAME} uninstallation completed."
