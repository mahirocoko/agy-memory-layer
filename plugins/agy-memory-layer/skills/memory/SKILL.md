---
name: memory
description: Inspect active memory blocks, Git snapshot commit history, or search across historical learnings in MemFS.
---

# /memory - MemFS Status, Inspection & Search

Inspect active memory blocks, Git snapshot commit history, or search across historical learnings.

## Quick Commands

```bash
# 1. Inspect active memory blocks & git status
/memory

# 2. Search historical memory blocks & learnings
/memory search <query>
```

## How It Works

1. **Inspection Mode (`/memory`)**:
   - Prints the committed projection: focused global/current-project `system/**/*.md`
     bodies plus a bounded path/description index for `reference/**/*.md`.
   - Uses the four-file legacy layout only when no layered owner exists.
   - Shows recent Git commit snapshots and uncommitted state.

2. **Search Mode (`/memory search <query>`)**:
   - Searches across all files in `~/.gemini/memory/` (including historical `learnings/*.md`).
   - When the shared communication adapter is enabled, searches the projected shared view.
   - Returns ranked match snippets with file paths, line numbers, and context.

3. **Shared Memory Inspection (`shared-memory.ts status`)**:
   - Displays the opt-in shared communication adapter status, source root, and pending proposals.

## Direct Script Execution

```bash
# Inspection
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-search.ts --status

# Search
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-search.ts "query"
```
