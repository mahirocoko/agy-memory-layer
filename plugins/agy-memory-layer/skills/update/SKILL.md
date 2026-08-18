---
name: update
description: Update agy-memory-layer plugin to the latest version while safely preserving all stored MemFS memory.
---

# /update

Updates the `agy-memory-layer` Antigravity CLI plugin to the latest release.

## Usage

```bash
/update
```

## How It Works

When invoked, the agent executes:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
if [ -f "$REPO_ROOT/plugins/agy-memory-layer/scripts/update.sh" ]; then
  bash "$REPO_ROOT/plugins/agy-memory-layer/scripts/update.sh"
else
  # Direct fallback update
  bash "$HOME/.gemini/antigravity-cli/plugins/agy-memory-layer/scripts/update.sh"
fi
```

## Guarantees

1. **MemFS Safety**: Never deletes or modifies user memories stored in `~/.gemini/memory/`.
2. **Permission Refresh**: Re-applies executable permissions to all shell scripts.
3. **Symlink Refresh**: Updates active plugin symlinks for Antigravity CLI.
4. **Hook Validation**: Verifies `PreInvocation` and `Stop` hook contracts.
