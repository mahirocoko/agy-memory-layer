#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTIVE_WORKSPACE="$(pwd)"
OUTPUT_FILE=""
TARGET_CONV_ID="${CONVERSATION_ID:-}"
OPEN_BROWSER=false
LEGACY_MODE=false

for arg in "$@"; do
  case "$arg" in
    --open)
      OPEN_BROWSER=true
      ;;
    --offline)
      ;;
    --legacy)
      LEGACY_MODE=true
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

RESOLVED_FILE=""
if [ "$LEGACY_MODE" = true ]; then
  LEGACY_OUT="${OUTPUT_FILE:-/tmp/agy-memory-palace.html}"
  node --experimental-strip-types "${SCRIPT_DIR}/palace-generator.ts" "$ACTIVE_WORKSPACE" "$LEGACY_OUT" "$TARGET_CONV_ID"
  RESOLVED_FILE="$LEGACY_OUT"
else
  EXPORT_JSON="$(node --experimental-strip-types "${SCRIPT_DIR}/palace-render.ts" "$ACTIVE_WORKSPACE" "$OUTPUT_FILE" "$TARGET_CONV_ID")"
  printf '%s\n' "$EXPORT_JSON"
  RESOLVED_FILE="$(printf '%s' "$EXPORT_JSON" | node -e 'const d = JSON.parse(require("node:fs").readFileSync(0, "utf8")); if (typeof d.filePath === "string") process.stdout.write(d.filePath);')"
fi

if [ "$OPEN_BROWSER" = true ] && [ -n "$RESOLVED_FILE" ]; then
  open "$RESOLVED_FILE" 2>/dev/null || xdg-open "$RESOLVED_FILE" 2>/dev/null || true
fi
