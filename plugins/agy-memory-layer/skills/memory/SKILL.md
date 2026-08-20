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
   - Prints active `global/human.md`, `global/persona.md`, and project-scoped `project.md` / `rules.md`.
   - Shows recent Git commit snapshots and uncommitted state.

2. **Search Mode (`/memory search <query>`)**:
   - Searches across all files in `~/.gemini/memory/` (including historical `learnings/*.md`).
   - Returns ranked match snippets with file paths, line numbers, and context.

## Direct Script Execution

```bash
# Inspection
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-search.ts --status

# Search
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-search.ts "query"
```
