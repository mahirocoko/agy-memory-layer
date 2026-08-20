#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_NAME="agy-memory-layer"
AGY_PLUGINS_DIR="${HOME}/.gemini/antigravity-cli/plugins"
CONFIG_LINK="${HOME}/.gemini/config/plugins/${PLUGIN_NAME}"
MEMORY_ROOT="${HOME}/.gemini/memory"

if [ -z "${HOME:-}" ] || [ "$HOME" = "/" ]; then
  echo "Refusing lifecycle operation with an unsafe HOME value." >&2
  exit 1
fi

assert_owned_or_absent() {
  local link_path="$1"
  if [ -L "$link_path" ]; then
    local existing_target
    existing_target="$(cd "$link_path" 2>/dev/null && pwd -P || true)"
    if [ -z "$existing_target" ] || [ ! -f "$existing_target/plugin.json" ] || ! grep -q '"name"[[:space:]]*:[[:space:]]*"agy-memory-layer"' "$existing_target/plugin.json"; then
      echo "Refusing to replace unowned symlink: $link_path" >&2
      exit 1
    fi
  elif [ -e "$link_path" ]; then
    echo "Refusing to replace non-symlink path: $link_path" >&2
    exit 1
  fi
}

replace_owned_symlink() {
  local link_path="$1"
  local target_path="$2"
  assert_owned_or_absent "$link_path"
  if [ -L "$link_path" ]; then rm -f "$link_path"; fi
  ln -s "$target_path" "$link_path"
}

echo "🔄 Refreshing Antigravity CLI Plugin: ${PLUGIN_NAME}"
echo "--------------------------------------------------"

TARGET_LINK="${AGY_PLUGINS_DIR}/${PLUGIN_NAME}"
assert_owned_or_absent "$TARGET_LINK"
assert_owned_or_absent "$CONFIG_LINK"

# 1. Ensure scripts are executable
chmod +x "${PLUGIN_ROOT}/scripts/"*.sh

# 2. Re-link plugin directory to Antigravity plugins directory
mkdir -p "$AGY_PLUGINS_DIR"
replace_owned_symlink "$TARGET_LINK" "$PLUGIN_ROOT"
echo "✓ Symlink refreshed at ${TARGET_LINK}"
mkdir -p "$(dirname "$CONFIG_LINK")"
replace_owned_symlink "$CONFIG_LINK" "$PLUGIN_ROOT"
echo "✓ Config symlink refreshed at ${CONFIG_LINK}"

# 3. Validate Hooks
echo "🔍 Validating hook contracts..."
echo '{"workspacePaths":["'$(pwd)'"]}' | "${PLUGIN_ROOT}/scripts/hook-inject-memory.sh" >/dev/null
echo '{"decision":"stop"}' | "${PLUGIN_ROOT}/scripts/hook-memory-status.sh" >/dev/null
if command -v agy >/dev/null 2>&1; then
  agy plugin validate "$PLUGIN_ROOT" >/dev/null
  echo "✓ Plugin schema validated with agy."
else
  echo "ℹ️  agy CLI not found; plugin schema validation skipped."
fi
echo "✓ Hooks validated successfully."

# 4. Report status
echo "--------------------------------------------------"
echo "🎉 ${PLUGIN_NAME} installation refreshed from the current source!"
echo "Your memory in ${MEMORY_ROOT} is safely preserved."
