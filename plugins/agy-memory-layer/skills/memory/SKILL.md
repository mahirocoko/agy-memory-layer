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

## Preferred MCP Path (`agent_memory_read` / `agent_memory_manage` / `continuity_recall`)

- **Inspect structure & health**: `agent_memory_manage` with `action: "status"`, `"history"`, or `"doctor"`.
- **Search & browse MemFS**: `agent_memory_read` supports `{ query, offset?, limit?, includeDraft? }` (Thai/English stopword stripping + `|` / `OR` clauses), `{ path, offset?, limit?, includeDraft? }` (Unicode code-point file reading or newest-first directory paging with child index previews), `{ topic, offset?, limit?, includeDraft? }` (namespace listing such as `"system"`, `"reference"`, `"projects/<slug>"`), or `{}` (list authorized files).
- **Recall prior session transcripts**: `continuity_recall` with `query` (searches `~/.gemini/antigravity-cli/brain/*` transcripts).

## How It Works

1. **Inspection Mode (`/memory`)**:
   - Prints the committed projection: focused global/current-project `system/**/*.md`
     bodies plus `Core.md` and a bounded path/description index for `reference/**/*.md` and `<dir>/index.md`.
   - Uses the four-file legacy layout only when no layered owner exists.
   - Shows recent Git commit snapshots and uncommitted state.

2. **Search Mode (`/memory search <query>`)**:
   - Uses Thai/English word segmentation (`Intl.Segmenter`) and stopword stripping across MemFS files (including `reference/`, `procedures/`, and historical `learnings/*.md`).
   - When the shared communication adapter is enabled, searches the projected shared view.
   - Returns ranked match snippets with file paths, line numbers, and context.

3. **Shared Memory Inspection (`shared-memory.ts status` / `list`)**:
   - Displays the opt-in shared communication adapter status, source root, pinned revision, and pending proposals in `~/.gemini/memory.state/shared-proposals/`.

## Direct Script Execution

```bash
# Inspection
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-search.ts --status

# Search
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-search.ts "query"

# Shared communication adapter status and pending proposals
node --experimental-strip-types plugins/agy-memory-layer/scripts/shared-memory.ts status
node --experimental-strip-types plugins/agy-memory-layer/scripts/shared-memory.ts list
```
