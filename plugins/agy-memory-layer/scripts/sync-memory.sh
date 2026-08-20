#!/usr/bin/env bash
set -e

MEMORY_ROOT="${AGY_MEMORY_DIR:-${HOME}/.gemini/memory}"
COMMAND="${1:-status}"
ARG="${2:-}"

if [ ! -d "$MEMORY_ROOT/.git" ]; then
  echo "Error: Memory repository not found at $MEMORY_ROOT"
  exit 1
fi

cd "$MEMORY_ROOT"

require_clean_memory() {
  if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
    echo "✖ MemFS has uncommitted changes. Commit or resolve them before remote sync." >&2
    exit 1
  fi
}

current_branch() {
  local branch
  branch="$(git branch --show-current 2>/dev/null)"
  if [ -z "$branch" ]; then
    echo "✖ Remote sync requires a named branch." >&2
    exit 1
  fi
  printf '%s' "$branch"
}

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
    require_clean_memory
    if ! git remote get-url origin >/dev/null 2>&1; then
      echo "✖ No Git remote configured. Run: /sync setup <remote-url> first."
      exit 1
    fi
    BRANCH="$(current_branch)"
    echo "Pushing memory snapshots to origin/$BRANCH..."
    git push -u origin "$BRANCH"
    echo "✔ Memory snapshots synced to remote."
    ;;

  pull)
    require_clean_memory
    if ! git remote get-url origin >/dev/null 2>&1; then
      echo "✖ No Git remote configured. Run: /sync setup <remote-url> first."
      exit 1
    fi
    BRANCH="$(current_branch)"
    echo "Pulling memory snapshots from origin/$BRANCH..."
    git pull --rebase origin "$BRANCH"
    echo "✔ Memory snapshots updated from remote."
    ;;

  sync)
    require_clean_memory
    if ! git remote get-url origin >/dev/null 2>&1; then
      echo "✖ No Git remote configured. Run: /sync setup <remote-url> first."
      exit 1
    fi
    BRANCH="$(current_branch)"
    echo "Syncing memory snapshots with remote origin/$BRANCH..."
    git pull --rebase origin "$BRANCH"
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
      BRANCH="$(current_branch)"
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
