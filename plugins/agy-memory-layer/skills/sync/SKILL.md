# /sync - Remote Git Synchronization

Sync your MemFS Git repository (`~/.gemini/memory/`) with a remote private Git repository (GitHub / GitLab) across development machines.

## Quick Commands

```bash
# 1. Check sync status & configured remote
/sync

# 2. Setup remote private repository URL
/sync setup git@github.com:mahirocoko/my-gemini-memory.git

# 3. Pull latest memories from remote
/sync pull

# 4. Push local memory snapshots to remote
/sync push

# 5. Full bidirectional sync (pull + push)
/sync all
```

## How It Works
- MemFS is an independent Git repository at `~/.gemini/memory/`.
- Connecting a remote private repository enables cross-machine continuity:
  - Work on your laptop &rarr; push snapshots.
  - Switch to your desktop / dev server &rarr; pull snapshots.
- Memory remains completely private to your Git account.
