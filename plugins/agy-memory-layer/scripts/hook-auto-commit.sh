#!/usr/bin/env bash
set -e

# Consume stdin payload
cat > /dev/null

MEMORY_ROOT="${HOME}/.gemini/memory"

if [ -d "${MEMORY_ROOT}/.git" ]; then
  # Check for uncommitted changes (unstaged or staged or untracked)
  CHANGED=$(git -C "$MEMORY_ROOT" status --porcelain 2>/dev/null || true)
  if [ -n "$CHANGED" ]; then
    NOW=$(date '+%Y-%m-%d %H:%M:%S')
    git -C "$MEMORY_ROOT" add -A >/dev/null 2>&1 || true
    git -C "$MEMORY_ROOT" commit -m "memfs auto-snapshot: ${NOW}" >/dev/null 2>&1 || true
  fi
fi

# Return JSON decision allowing stop
echo '{"decision": "stop"}'
