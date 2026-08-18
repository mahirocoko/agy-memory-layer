#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLUGIN_NAME="agy-memory-layer"
AGY_PLUGINS_DIR="${HOME}/.gemini/antigravity-cli/plugins"
MEMORY_ROOT="${HOME}/.gemini/memory"

echo "🧠 Installing Antigravity CLI Plugin: ${PLUGIN_NAME}"
echo "--------------------------------------------------"

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

  git -C "$MEMORY_ROOT" add -A
  git -C "$MEMORY_ROOT" commit -m "memory-layer: initial memory repository bootstrap" >/dev/null 2>&1 || true
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
rm -rf "${AGY_PLUGINS_DIR}/memfs"

TARGET_LINK="${AGY_PLUGINS_DIR}/${PLUGIN_NAME}"
if [ -L "$TARGET_LINK" ] || [ -d "$TARGET_LINK" ]; then
  rm -rf "$TARGET_LINK"
fi

ln -sf "$PLUGIN_ROOT" "$TARGET_LINK"
echo "✓ Plugin linked to ${TARGET_LINK}"

# 4. Verify hooks
echo "🔍 Validating hook scripts..."
echo '{"workspacePaths":["'$(pwd)'"]}' | "${PLUGIN_ROOT}/scripts/hook-inject-memory.sh" >/dev/null
echo '{"decision":"stop"}' | "${PLUGIN_ROOT}/scripts/hook-auto-commit.sh" >/dev/null
echo "✓ Hook validation passed."

echo "--------------------------------------------------"
echo "🎉 ${PLUGIN_NAME} plugin installed successfully!"
echo "Available commands & skills:"
echo "  /memory   - Inspect active memory blocks & git history"
echo "  /remember - Record a preference or rule"
echo "  /dream    - Sleep-time reflection subagent"
echo "  /doctor   - Memory consistency & health auditor"
echo "  /palace   - Visual Memory Palace dashboard"
echo ""
echo "To disable temporarily: agy plugin disable ${PLUGIN_NAME}"
echo "To uninstall:           ${PLUGIN_ROOT}/scripts/uninstall.sh"
