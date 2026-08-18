#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTIVE_WORKSPACE="$(pwd)"
OUTPUT_FILE="/tmp/agy-memory-palace.html"
TARGET_CONV_ID="${CONVERSATION_ID:-}"
OPEN_BROWSER=false

for arg in "$@"; do
  case "$arg" in
    --open)
      OPEN_BROWSER=true
      ;;
    *.html)
      OUTPUT_FILE="$arg"
      ;;
    conv-*)
      TARGET_CONV_ID="${arg#conv-}"
      ;;
    *)
      if [ -d "$arg" ]; then
        ACTIVE_WORKSPACE="$arg"
      elif [[ "$arg" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
        TARGET_CONV_ID="$arg"
      fi
      ;;
  esac
done

node "${SCRIPT_DIR}/palace-generator.js" "$ACTIVE_WORKSPACE" "$OUTPUT_FILE" "$TARGET_CONV_ID"

if [ "$OPEN_BROWSER" = true ]; then
  open "$OUTPUT_FILE" 2>/dev/null || xdg-open "$OUTPUT_FILE" 2>/dev/null || true
fi
