#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="${SCRIPT_DIR}/hook-pre-tool-use.ts"

if ! command -v node >/dev/null 2>&1; then
  echo "agy-memory-layer: Node.js 22+ is required for PreToolUse" >&2
  exit 1
fi

if [ ! -f "$SCRIPT_PATH" ]; then
  echo "agy-memory-layer: missing PreToolUse implementation at ${SCRIPT_PATH}" >&2
  exit 1
fi

exec node --experimental-strip-types "$SCRIPT_PATH"
