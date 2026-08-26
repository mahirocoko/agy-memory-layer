#!/usr/bin/env bash
set -e

PLUGIN_NAME="agy-memory-layer"
AGY_PLUGINS_DIR="${HOME}/.gemini/antigravity-cli/plugins"
TARGET_LINK="${AGY_PLUGINS_DIR}/${PLUGIN_NAME}"
LEGACY_LINK="${AGY_PLUGINS_DIR}/memfs"
CONFIG_LINK="${HOME}/.gemini/config/plugins/${PLUGIN_NAME}"
MEMORY_ROOT="${HOME}/.gemini/memory"
MEMORY_STATE_ROOT="${MEMORY_ROOT}.state"

if [ -z "${HOME:-}" ] || [ "$HOME" = "/" ]; then
  echo "Refusing lifecycle operation with an unsafe HOME value." >&2
  exit 1
fi

PURGE=false
if [ "${1:-}" = "--purge" ]; then
  if [ "${2:-}" != "--confirm-purge" ]; then
    echo "Refusing destructive purge without: --purge --confirm-purge" >&2
    exit 1
  fi
  if [ -L "$MEMORY_ROOT" ]; then
    echo "Refusing to purge a symlinked memory root: $MEMORY_ROOT" >&2
    exit 1
  fi
  RESOLVED_MEMORY_ROOT="$(cd "$MEMORY_ROOT" 2>/dev/null && pwd -P || true)"
  REPOSITORY_ROOT="$(git -C "$MEMORY_ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
  LEGACY_SIGNATURE=false
  LAYERED_SIGNATURE=false
  if git -C "$MEMORY_ROOT" cat-file -e HEAD:global/human.md 2>/dev/null && git -C "$MEMORY_ROOT" cat-file -e HEAD:global/persona.md 2>/dev/null; then
    LEGACY_SIGNATURE=true
  fi
  if git -C "$MEMORY_ROOT" cat-file -e HEAD:system/human/identity.md 2>/dev/null && git -C "$MEMORY_ROOT" cat-file -e HEAD:system/persona.md 2>/dev/null; then
    LAYERED_SIGNATURE=true
  fi
  if [ -z "$RESOLVED_MEMORY_ROOT" ] || [ "$REPOSITORY_ROOT" != "$RESOLVED_MEMORY_ROOT" ] || { [ "$LEGACY_SIGNATURE" != true ] && [ "$LAYERED_SIGNATURE" != true ]; }; then
    echo "Refusing to purge an unproven MemFS directory: $MEMORY_ROOT" >&2
    exit 1
  fi
  PURGE=true
elif [ -n "${1:-}" ]; then
  echo "Unknown argument: $1" >&2
  exit 1
fi

assert_owned_or_absent() {
  local link_path="$1"
  if [ -L "$link_path" ]; then
    local existing_target
    existing_target="$(cd "$link_path" 2>/dev/null && pwd -P || true)"
    if [ -z "$existing_target" ] || [ ! -f "$existing_target/plugin.json" ] || ! grep -q '"name"[[:space:]]*:[[:space:]]*"agy-memory-layer"' "$existing_target/plugin.json"; then
      echo "Refusing to remove unowned symlink: $link_path" >&2
      exit 1
    fi
  elif [ -e "$link_path" ]; then
    echo "Refusing to remove non-symlink path: $link_path" >&2
    exit 1
  fi
}

assert_owned_or_absent "$TARGET_LINK"
assert_owned_or_absent "$LEGACY_LINK"
assert_owned_or_absent "$CONFIG_LINK"

remove_owned_link() {
  local link_path="$1"
  assert_owned_or_absent "$link_path"
  if [ -L "$link_path" ]; then
    rm -f "$link_path"
  elif [ -e "$link_path" ]; then
    echo "Refusing to remove non-symlink path: $link_path" >&2
    return 1
  fi
}

echo "🗑️  Uninstalling Antigravity CLI Plugin: ${PLUGIN_NAME}"
echo "--------------------------------------------------"

# 1. Unregister via agy plugin CLI if available
if command -v agy >/dev/null 2>&1; then
  echo "🔌 Unregistering from agy CLI..."
  agy plugin uninstall "${PLUGIN_NAME}" 2>/dev/null || true
fi

# 2. Remove plugin links from AGY plugins directory
remove_owned_link "$TARGET_LINK"
remove_owned_link "$LEGACY_LINK"
remove_owned_link "$CONFIG_LINK"
echo "✓ Plugin removed from ${AGY_PLUGINS_DIR}"

# 3. Check memory repository
if [ "$PURGE" = true ]; then
  echo "⚠️  Purge requested: Removing Git memory repository at ${MEMORY_ROOT}..."
  rm -rf "$MEMORY_ROOT"
  if [ ! -L "$MEMORY_STATE_ROOT" ]; then rm -rf "$MEMORY_STATE_ROOT"; fi
  echo "✓ MemFS memory repository purged."
else
  echo "ℹ️  Git memory repository preserved at ${MEMORY_ROOT}."
  echo "   (To delete memory completely, re-run with: $0 --purge --confirm-purge)"
fi

echo "--------------------------------------------------"
echo "✓ ${PLUGIN_NAME} uninstallation completed."
