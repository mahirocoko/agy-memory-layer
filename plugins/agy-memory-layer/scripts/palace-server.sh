#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTIVE_WORKSPACE="$(pwd)"
OUTPUT_FILE="/tmp/agy-memory-palace.html"
OPEN_BROWSER=false

for arg in "$@"; do
  case "$arg" in
    --open)
      OPEN_BROWSER=true
      ;;
    *.html)
      OUTPUT_FILE="$arg"
      ;;
    *)
      if [ -d "$arg" ]; then
        ACTIVE_WORKSPACE="$arg"
      fi
      ;;
  esac
done

node "${SCRIPT_DIR}/palace-generator.js" "$ACTIVE_WORKSPACE" "$OUTPUT_FILE"

if [ "$OPEN_BROWSER" = true ]; then
  open "$OUTPUT_FILE" 2>/dev/null || xdg-open "$OUTPUT_FILE" 2>/dev/null || true
fi
