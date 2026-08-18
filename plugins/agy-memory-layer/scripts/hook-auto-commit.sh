#!/usr/bin/env bash
set -e

# Consume stdin payload
cat > /dev/null

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEMORY_ROOT="${HOME}/.gemini/memory"

if [ -d "${MEMORY_ROOT}/.git" ]; then
  # 1. Check for uncommitted changes in MemFS and auto-snapshot
  CHANGED=$(git -C "$MEMORY_ROOT" status --porcelain 2>/dev/null || true)
  if [ -n "$CHANGED" ]; then
    NOW=$(date '+%Y-%m-%d %H:%M:%S')
    git -C "$MEMORY_ROOT" add -A >/dev/null 2>&1 || true
    git -C "$MEMORY_ROOT" commit -m "memfs auto-snapshot: ${NOW}" >/dev/null 2>&1 || true
  fi
fi

# 2. Asynchronously check step-count trigger & auto-dream in background (Non-blocking)
if [ -f "${SCRIPT_DIR}/dream-daemon.ts" ]; then
  (node --experimental-strip-types "${SCRIPT_DIR}/dream-daemon.ts" --auto-check >/dev/null 2>&1 &) || true
elif [ -f "${SCRIPT_DIR}/dream-daemon.js" ]; then
  (node "${SCRIPT_DIR}/dream-daemon.js" --auto-check >/dev/null 2>&1 &) || true
fi

# Return JSON decision allowing stop
echo '{"decision": "stop"}'
