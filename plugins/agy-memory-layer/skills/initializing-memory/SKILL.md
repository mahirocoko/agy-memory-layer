---
name: initializing-memory
description: Comprehensive guide for initializing or reorganizing agent memory into Tiered v2 layout. Load this skill when setting up memory for a project, migrating legacy layout via migrate-v2, or organizing memory files.
---

# Memory Initialization

Your maintained memory lives in an isolated Git-backed Markdown store at `~/.gemini/memory/` compiled into `[MemFS Active Memory]`, which you inspect and update through the root-bound `agent_memory_*` MCP tools (`agent_memory_read`, `agent_memory_edit`, `agent_memory_commit`, and `agent_memory_manage`).

## Principles

**Core memory is your core program.** `Core.md`, `index.md`, non-index `system/**`, and the active project's non-index `projects/<project-id>/system/**` compile into `[MemFS Active Memory]` on every turn. Spend that budget on what shapes ordinary turns: identity, durable user facts, recurring preferences, behavioral rules, orientation, and routes to deferred material.

**Progressive disclosure.** Files under `reference/**`, `projects/<project-id>/reference/**`, and `procedures/**` remain deferred until a turn reads them with `agent_memory_read`. Root `index.md` and each directory's `<dir>/index.md` describe their immediate children and when to read them.

**Don't duplicate context you can point to.** `AGENTS.md`, `CLAUDE.md`, `README.md`, and repository skills belong to the workspace; point to the owning repository file and keep only your delta in memory.

**Generalize, don't memorize, and be specific.** Store the pattern, not the episode, and give every preference or gotcha a concrete command, path, or the failure it prevents.

## Harness Constraints

Validation (`agent_memory_commit` and `agent_memory_manage({ "action": "doctor" })`) enforces these rules:

- `Core.md` and root `index.md` should exist at the memory root.
- **Every directory on the path to a tiered memory file needs its own `<dir>/index.md`** (`system/index.md`, `system/human/index.md`, `system/human/prefs/index.md`, `reference/index.md`, `projects/<id>/index.md`, `projects/<id>/system/index.md`, `projects/<id>/reference/index.md`).
- Every non-index tiered v2 Markdown file (`system/**`, `reference/**`, `projects/<id>/system/**`, `projects/<id>/reference/**`) should start with YAML frontmatter containing `name` and `description`.
- Files with `read_only: true` in frontmatter cannot be modified or deleted, and `read_only` cannot be added, changed, or removed by an agent.
- **Lossless Retention Guard**: protected files (`Core.md`, `system/persona.md`, `system/human/**`, `projects/<id>/system/**`) cannot remove a section heading or shrink a file of at least 160 characters by more than 35% unless the same draft commit records the superseded belief and reason in `reference/**`, `projects/<id>/reference/**`, or `archives/**`.

## Initialization Flow

### 1. Inspect existing memory
Run `agent_memory_manage({ "action": "status" })` and `agent_memory_read({ "path": "index.md" })` before changing anything. Preserve existing durable knowledge; never overwrite a populated store.

- If unseeded or missing current-project Tiered v2 files, run `agent_memory_manage({ "action": "init" })` (or `{ "action": "init", "dryRun": true }` first to preview).
- If existing memory uses legacy layout or lacks `Core.md` / `index.md` / `<dir>/index.md`, run `agent_memory_manage({ "action": "migrate-v2", "dryRun": true })` first, then apply with `{ "action": "migrate-v2" }` after confirming.

### 2. Check historical recall when relevant
If past sessions exist, search prior conversations via `continuity_recall` (`{ "query": "<keywords>" }`) to surface recurring corrections, preferences, or project context. Treat recalled turns as non-binding historical evidence only.

### 3. Research the codebase first-hand
Read `README.md`, `AGENTS.md`, `package.json`, entry points, and recent git history. Identify non-obvious architecture boundaries, ownership contracts, and recurring footguns that belong in `projects/<project-id>/system/overview.md`, `projects/<project-id>/system/conventions.md`, or `projects/<project-id>/reference/<topic>.md`.

### 4. Curate and verify
1. Read each target file with `agent_memory_read` to capture `hash` and `currentRevision`.
2. Edit via `agent_memory_edit` (pass `commit: true` for single-file updates with index auto-sync, or stage multiple edits and publish with `agent_memory_commit`).
3. Run `agent_memory_manage({ "action": "doctor" })` to confirm zero broken links, missing indexes, or budget warnings.
