#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Prefer cross-platform TypeScript / Node implementation if available
if [ -f "${SCRIPT_DIR}/hook-auto-commit.ts" ]; then
  exec node --experimental-strip-types "${SCRIPT_DIR}/hook-auto-commit.ts"
elif [ -f "${SCRIPT_DIR}/hook-auto-commit.js" ]; then
  exec node "${SCRIPT_DIR}/hook-auto-commit.js"
fi

# Fallback POSIX execution
cat > /dev/null
MEMORY_ROOT="${AGY_MEMORY_DIR:-${HOME}/.gemini/memory}"

if [ -d "${MEMORY_ROOT}/.git" ]; then
  CHANGED=$(git -C "$MEMORY_ROOT" status --porcelain 2>/dev/null || true)
  if [ -n "$CHANGED" ]; then
    NOW=$(date '+%Y-%m-%d %H:%M:%S')
    git -C "$MEMORY_ROOT" add -A >/dev/null 2>&1 || true
    git -C "$MEMORY_ROOT" commit -m "memfs auto-snapshot: ${NOW}" >/dev/null 2>&1 || true
  fi
fi

if [ -f "${SCRIPT_DIR}/dream-daemon.ts" ]; then
  (node --experimental-strip-types "${SCRIPT_DIR}/dream-daemon.ts" --auto-check >/dev/null 2>&1 &) || true
fi

echo '{"decision": "stop"}'
