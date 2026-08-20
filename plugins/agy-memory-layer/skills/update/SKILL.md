---
name: update
description: Refresh the active agy-memory-layer link, permissions, and hook validation from the current installed source without modifying MemFS.
---

# /update

Refreshes the active `agy-memory-layer` installation from its current source checkout.

This command does **not** download a newer release. Update a local checkout with Git, or rerun the root installer for a remote cached installation, before invoking `/update`.

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

1. **MemFS Safety**: Never stages, commits, deletes, or rewrites user memories stored in `~/.gemini/memory/`.
2. **Permission Refresh**: Re-applies executable permissions to all shell scripts.
3. **Symlink Refresh**: Updates active plugin symlinks only after the resolved manifest proves plugin ownership.
4. **Hook Validation**: Verifies committed-memory `PreInvocation` and non-mutating `Stop` hook contracts.
5. **No Download Claim**: Reports a source refresh only; release acquisition remains outside this script.
