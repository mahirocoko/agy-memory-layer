#!/usr/bin/env bash
set -e

PLUGIN_NAME="agy-memory-layer"
REPO_URL="https://github.com/mahirocoko/agy-memory-layer.git"
INSTALL_DIR="${HOME}/.gemini/antigravity-cli/plugins/${PLUGIN_NAME}"
CONFIG_DIR="${HOME}/.gemini/config/plugins/${PLUGIN_NAME}"
LEGACY_LINK="${HOME}/.gemini/antigravity-cli/plugins/memfs"
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

assert_owned_or_absent "$INSTALL_DIR"
assert_owned_or_absent "$CONFIG_DIR"
assert_owned_or_absent "$LEGACY_LINK"

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
    git -C "$CLONE_TARGET" pull --ff-only --quiet
  else
    if [ -e "$CLONE_TARGET" ] || [ -L "$CLONE_TARGET" ]; then
      echo "Refusing to replace non-repository cache path: $CLONE_TARGET" >&2
      exit 1
    fi
    git clone --depth 1 "$REPO_URL" "$CLONE_TARGET" --quiet
  fi
  SOURCE_DIR="$CLONE_TARGET/plugins/${PLUGIN_NAME}"
fi

# 1. Make all scripts executable
chmod +x "$SOURCE_DIR/scripts/"*.sh

# 2. Setup Memory Git Repository (MemFS)
mkdir -p "$MEMORY_ROOT"

if [ ! -d "${MEMORY_ROOT}/.git" ]; then
  if [ -n "$(find "$MEMORY_ROOT" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
    echo "Refusing to initialize non-empty memory directory without Git: ${MEMORY_ROOT}" >&2
    echo "Back it up and initialize or migrate it explicitly; installer will not shadow existing files." >&2
    exit 1
  fi
  echo "📦 Initializing Git-backed MemFS at ${MEMORY_ROOT}..."
  git -C "$MEMORY_ROOT" init -b main >/dev/null 2>&1 || git -C "$MEMORY_ROOT" init >/dev/null 2>&1
  
  mkdir -p "${MEMORY_ROOT}/system/human/prefs" "${MEMORY_ROOT}/reference" "${MEMORY_ROOT}/projects" "${MEMORY_ROOT}/archives"

  cat << 'EOF' > "${MEMORY_ROOT}/system/human/identity.md"
---
description: Stable user identity and collaboration context.
---
# Human Identity

- Learn stable identity from direct evidence; do not infer personal facts.
EOF

  cat << 'EOF' > "${MEMORY_ROOT}/system/human/prefs/communication.md"
---
description: Stable communication and response-style preferences.
---
# Communication

- Language: Thai or English as requested.
- Tone: Direct, concise, technical, no unnecessary fluff.
EOF

  cat << 'EOF' > "${MEMORY_ROOT}/system/human/prefs/coding.md"
---
description: Cross-project coding defaults used only when repository guidance is silent.
---
# Coding Defaults

- Package Manager: Always use exact version flag (`-E`) when installing packages.
- Strict typing, explicit error boundaries, avoid any.
EOF

  cat << 'EOF' > "${MEMORY_ROOT}/system/persona.md"
---
description: Persistent agent identity and operating posture.
---
# Agent Persona: Stateful Pair Programmer

You are a persistent, stateful pair programming assistant backed by MemFS.
You retain context across sessions, continuously learn from user feedback, and respect project conventions.
EOF

  git -C "$MEMORY_ROOT" add -- system/human/identity.md system/human/prefs/communication.md system/human/prefs/coding.md system/persona.md
  git -C "$MEMORY_ROOT" \
    -c user.name=agy-memory-layer \
    -c user.email=agy-memory-layer@local.invalid \
    commit -m "memory-layer: initial memory repository bootstrap" >/dev/null
  echo "✓ MemFS Git repository initialized."
else
  echo "✓ MemFS Git repository already exists at ${MEMORY_ROOT}."
fi

# 3. Register Plugin via Symlinks
mkdir -p "$(dirname "$INSTALL_DIR")"
if [ -L "$LEGACY_LINK" ]; then
  replace_owned_symlink "$LEGACY_LINK" "$SOURCE_DIR"
  rm -f "$LEGACY_LINK"
elif [ -e "$LEGACY_LINK" ]; then
  echo "Refusing to replace non-symlink legacy path: $LEGACY_LINK" >&2
  exit 1
fi
if [ "$SOURCE_DIR" != "$INSTALL_DIR" ]; then
  replace_owned_symlink "$INSTALL_DIR" "$SOURCE_DIR"
fi
echo "✓ Plugin linked to ${INSTALL_DIR}"

mkdir -p "$(dirname "$CONFIG_DIR")"
if [ "$SOURCE_DIR" != "$CONFIG_DIR" ]; then
  replace_owned_symlink "$CONFIG_DIR" "$SOURCE_DIR"
fi
echo "✓ Plugin config linked to ${CONFIG_DIR}"

# 4. Register with agy CLI if installed
if command -v agy >/dev/null 2>&1; then
  echo "🔌 Registering with agy CLI..."
  agy plugin install "${SOURCE_DIR}" >/dev/null 2>&1 || true
fi

# 5. Verify hooks through the installed symlink
echo "🔍 Validating hook scripts..."
INJECT_OUTPUT="$(printf '{"workspacePaths":["%s"]}' "$(pwd)" | "$INSTALL_DIR/scripts/hook-inject-memory.sh")"
printf '%s' "$INJECT_OUTPUT" | node -e 'const fs=require("node:fs");const value=JSON.parse(fs.readFileSync(0,"utf8"));if(!Array.isArray(value.injectSteps)||value.injectSteps.length===0)process.exit(1)'
STOP_OUTPUT="$(printf '{"decision":"stop"}' | "$INSTALL_DIR/scripts/hook-memory-status.sh")"
printf '%s' "$STOP_OUTPUT" | node -e 'const fs=require("node:fs");const value=JSON.parse(fs.readFileSync(0,"utf8"));if(value.decision!=="stop")process.exit(1)'
echo "✓ Hook validation passed."

echo "=================================================="
echo "🎉 ${PLUGIN_NAME} installed successfully!"
echo "Available skills in Antigravity CLI:"
echo "  /evidence-controller - Evidence-scoped execution & native delegation"
echo "  /memory   - Inspect active memory blocks & git history"
echo "  /remember - Record a preference or rule"
echo "  /dream    - Archive explicit correction evidence"
echo "  /doctor   - Memory consistency & health auditor"
echo "  /palace   - Visual Memory Palace dashboard"
echo "  /update   - Refresh the active plugin link from the current source"
echo ""
echo "Start pair programming in any workspace — your agent is now stateful! 🚀"
