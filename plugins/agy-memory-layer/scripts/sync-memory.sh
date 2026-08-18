#!/usr/bin/env bash
set -e

MEMORY_ROOT="${HOME}/.gemini/memory"
COMMAND="${1:-status}"
ARG="${2:-}"

if [ ! -d "$MEMORY_ROOT/.git" ]; then
  echo "Error: Memory repository not found at $MEMORY_ROOT"
  exit 1
fi

cd "$MEMORY_ROOT"

case "$COMMAND" in
  setup)
    if [ -z "$ARG" ]; then
      echo "Usage: sync-memory.sh setup <remote-git-url>"
      exit 1
    fi
    if git remote get-url origin >/dev/null 2>&1; then
      git remote set-url origin "$ARG"
      echo "✔ Updated Git remote 'origin' to: $ARG"
    else
      git remote add origin "$ARG"
      echo "✔ Added Git remote 'origin': $ARG"
    fi
    ;;

  push)
    if ! git remote get-url origin >/dev/null 2>&1; then
      echo "✖ No Git remote configured. Run: /sync setup <remote-url> first."
      exit 1
    fi
    BRANCH="$(git branch --show-current 2>/dev/null || echo "main")"
    echo "Pushing memory snapshots to origin/$BRANCH..."
    git push -u origin "$BRANCH"
    echo "✔ Memory snapshots synced to remote."
    ;;

  pull)
    if ! git remote get-url origin >/dev/null 2>&1; then
      echo "✖ No Git remote configured. Run: /sync setup <remote-url> first."
      exit 1
    fi
    BRANCH="$(git branch --show-current 2>/dev/null || echo "main")"
    echo "Pulling memory snapshots from origin/$BRANCH..."
    git pull --rebase origin "$BRANCH"
    echo "✔ Memory snapshots updated from remote."
    ;;

  sync)
    if ! git remote get-url origin >/dev/null 2>&1; then
      echo "✖ No Git remote configured. Run: /sync setup <remote-url> first."
      exit 1
    fi
    BRANCH="$(git branch --show-current 2>/dev/null || echo "main")"
    echo "Syncing memory snapshots with remote origin/$BRANCH..."
    git pull --rebase origin "$BRANCH" || true
    git push origin "$BRANCH"
    echo "✔ Multi-device sync complete."
    ;;

  status)
    echo "=================================================="
    echo "☁️ MemFS Remote Sync Status"
    echo "=================================================="
    echo "- Memory Root : $MEMORY_ROOT"
    if git remote get-url origin >/dev/null 2>&1; then
      REMOTE_URL="$(git remote get-url origin)"
      BRANCH="$(git branch --show-current 2>/dev/null || echo "main")"
      echo "- Remote URL  : $REMOTE_URL"
      echo "- Active Branch: $BRANCH"
      echo "- Local Commits: $(git rev-list --count HEAD 2>/dev/null || echo 0)"
    else
      echo "- Remote URL  : (Not configured - local only)"
      echo "- Setup Guide : Run '/sync setup <private-repo-url>' to enable multi-device sync."
    fi
    echo "=================================================="
    ;;

  *)
    echo "Usage: sync-memory.sh [setup <url> | push | pull | sync | status]"
    exit 1
    ;;
esac
