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

echo "🧠 Installing Antigravity CLI Plugin: ${PLUGIN_NAME}"
echo "--------------------------------------------------"

assert_owned_or_absent "${AGY_PLUGINS_DIR}/${PLUGIN_NAME}"
assert_owned_or_absent "${AGY_PLUGINS_DIR}/memfs"
assert_owned_or_absent "$CONFIG_LINK"

# 1. Make all scripts executable
chmod +x "${PLUGIN_ROOT}/scripts/"*.sh

# 2. Setup Memory Git Repository
mkdir -p "${MEMORY_ROOT}/global" "${MEMORY_ROOT}/projects"

if [ ! -d "${MEMORY_ROOT}/.git" ]; then
  echo "📦 Initializing Git-backed MemFS at ${MEMORY_ROOT}..."
  git -C "$MEMORY_ROOT" init -b main >/dev/null 2>&1 || git -C "$MEMORY_ROOT" init >/dev/null 2>&1
  
  # Create initial human.md if not existing
  if [ ! -f "${MEMORY_ROOT}/global/human.md" ]; then
    cat << 'EOF' > "${MEMORY_ROOT}/global/human.md"
# Human Profile & Preferences

## Communication & Style
- Language: Thai or English as requested.
- Tone: Direct, concise, technical, no unnecessary fluff.

## General Coding Standards
- Package Manager: Always use exact version flag (`-E`) when installing packages.
- Strict typing, explicit error boundaries, avoid any.
EOF
  fi

  # Create initial persona.md if not existing
  if [ ! -f "${MEMORY_ROOT}/global/persona.md" ]; then
    cat << 'EOF' > "${MEMORY_ROOT}/global/persona.md"
# Agent Persona: Stateful Pair Programmer

You are a persistent, stateful pair programming assistant backed by MemFS.
You retain context across sessions, continuously learn from user feedback, and respect project conventions.
EOF
  fi

  git -C "$MEMORY_ROOT" add -- global/human.md global/persona.md
  git -C "$MEMORY_ROOT" \
    -c user.name=agy-memory-layer \
    -c user.email=agy-memory-layer@local.invalid \
    commit -m "memory-layer: initial memory repository bootstrap" >/dev/null
  echo "✓ MemFS Git repository initialized."
else
  echo "✓ MemFS Git repository already exists at ${MEMORY_ROOT}."
fi

# 3. Register Plugin via agy plugin CLI or directory symlink
if command -v agy >/dev/null 2>&1; then
  echo "🔌 Registering with agy CLI..."
  agy plugin install "${PLUGIN_ROOT}" || true
fi

mkdir -p "$AGY_PLUGINS_DIR"
if [ -L "${AGY_PLUGINS_DIR}/memfs" ]; then
  replace_owned_symlink "${AGY_PLUGINS_DIR}/memfs" "$PLUGIN_ROOT"
  rm -f "${AGY_PLUGINS_DIR}/memfs"
elif [ -e "${AGY_PLUGINS_DIR}/memfs" ]; then
  echo "Refusing to replace non-symlink legacy path: ${AGY_PLUGINS_DIR}/memfs" >&2
  exit 1
fi

TARGET_LINK="${AGY_PLUGINS_DIR}/${PLUGIN_NAME}"
replace_owned_symlink "$TARGET_LINK" "$PLUGIN_ROOT"
echo "✓ Plugin linked to ${TARGET_LINK}"

mkdir -p "$(dirname "$CONFIG_LINK")"
replace_owned_symlink "$CONFIG_LINK" "$PLUGIN_ROOT"
echo "✓ Plugin config linked to ${CONFIG_LINK}"

# 4. Verify hooks
echo "🔍 Validating hook scripts..."
echo '{"workspacePaths":["'$(pwd)'"]}' | "${PLUGIN_ROOT}/scripts/hook-inject-memory.sh" >/dev/null
echo '{"decision":"stop"}' | "${PLUGIN_ROOT}/scripts/hook-memory-status.sh" >/dev/null
echo "✓ Hook validation passed."

echo "--------------------------------------------------"
echo "🎉 ${PLUGIN_NAME} plugin installed successfully!"
echo "Available commands & skills:"
echo "  /evidence-controller - Evidence-scoped execution & native delegation"
echo "  /memory   - Inspect active memory blocks & git history"
echo "  /remember - Record a preference or rule"
echo "  /dream    - Archive explicit correction evidence"
echo "  /doctor   - Memory consistency & health auditor"
echo "  /palace   - Visual Memory Palace dashboard"
echo ""
echo "To disable temporarily: agy plugin disable ${PLUGIN_NAME}"
echo "To uninstall:           ${PLUGIN_ROOT}/scripts/uninstall.sh"
