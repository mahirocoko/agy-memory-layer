#!/usr/bin/env bash
set -e

PLUGIN_NAME="agy-memory-layer"
REPO_URL="https://github.com/mahirocoko/agy-memory-layer.git"
INSTALL_DIR="${HOME}/.gemini/antigravity-cli/plugins/${PLUGIN_NAME}"
CONFIG_DIR="${HOME}/.gemini/config/plugins/${PLUGIN_NAME}"
MEMORY_ROOT="${HOME}/.gemini/memory"

echo "🧠 Installing Antigravity CLI Plugin: ${PLUGIN_NAME}"
echo "=================================================="

# Check if running locally inside cloned repo or via curl | bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/plugins/${PLUGIN_NAME}/plugin.json" ]; then
  # Local install from repo root
  SOURCE_DIR="$SCRIPT_DIR/plugins/${PLUGIN_NAME}"
  echo "📂 Installing from local repository ($SOURCE_DIR)..."
elif [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/plugin.json" ]; then
  # Local install from plugin dir
  SOURCE_DIR="$SCRIPT_DIR"
  echo "📂 Installing from local plugin directory ($SOURCE_DIR)..."
else
  # Remote install via curl | bash -> clone directly into plugin directory
  echo "🌐 Remote installation detected. Downloading ${PLUGIN_NAME} from GitHub..."
  mkdir -p "${HOME}/.gemini/antigravity-cli/plugins"
  
  CLONE_TARGET="${HOME}/.gemini/antigravity-cli/plugins/.source-${PLUGIN_NAME}"
  if [ -d "$CLONE_TARGET/.git" ]; then
    echo "📥 Updating existing cached repository..."
    git -C "$CLONE_TARGET" pull --quiet || true
  else
    rm -rf "$CLONE_TARGET"
    git clone --depth 1 "$REPO_URL" "$CLONE_TARGET" --quiet
  fi
  SOURCE_DIR="$CLONE_TARGET/plugins/${PLUGIN_NAME}"
fi

# 1. Make all scripts executable
chmod +x "$SOURCE_DIR/scripts/"*.sh

# 2. Setup Memory Git Repository (MemFS)
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

# 3. Register Plugin via Symlinks
mkdir -p "$(dirname "$INSTALL_DIR")"
if [ "$SOURCE_DIR" != "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  ln -sf "$SOURCE_DIR" "$INSTALL_DIR"
fi
echo "✓ Plugin linked to ${INSTALL_DIR}"

mkdir -p "$(dirname "$CONFIG_DIR")"
if [ "$SOURCE_DIR" != "$CONFIG_DIR" ]; then
  rm -rf "$CONFIG_DIR"
  ln -sf "$SOURCE_DIR" "$CONFIG_DIR"
fi
echo "✓ Plugin config linked to ${CONFIG_DIR}"

# 4. Register with agy CLI if installed
if command -v agy >/dev/null 2>&1; then
  echo "🔌 Registering with agy CLI..."
  agy plugin install "${SOURCE_DIR}" >/dev/null 2>&1 || true
fi

# 5. Verify hooks
echo "🔍 Validating hook scripts..."
echo '{"workspacePaths":["'$(pwd)'"]}' | "$SOURCE_DIR/scripts/hook-inject-memory.sh" >/dev/null
echo '{"decision":"stop"}' | "$SOURCE_DIR/scripts/hook-auto-commit.sh" >/dev/null
echo "✓ Hook validation passed."

echo "=================================================="
echo "🎉 ${PLUGIN_NAME} installed successfully!"
echo "Available skills in Antigravity CLI:"
echo "  /memory   - Inspect active memory blocks & git history"
echo "  /remember - Record a preference or rule"
echo "  /dream    - Sleep-time reflection subagent"
echo "  /doctor   - Memory consistency & health auditor"
echo "  /palace   - Visual Memory Palace dashboard"
echo "  /update   - Update plugin to latest version"
echo ""
echo "Start pair programming in any workspace — your agent is now stateful! 🚀"
