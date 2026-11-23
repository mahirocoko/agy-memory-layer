---
name: syncing-memory-filesystem
description: Diagnose and repair maintained memory repository state, uncommitted drafts, CAS revision/hash conflicts, Lossless Retention Guard rejections, or broken directory indexes. Do not load for routine memory reads or edits.
---

# Memory Repository & Draft Sync Repair

Use this skill when maintained memory edits fail to commit, when a draft encounters a revision or content-hash conflict, or when `agent_memory_manage({ "action": "doctor" })` reports structural/index drift. Before editing memory content, follow the rules in `maintaining-core-memory` for always-loaded files (`Core.md`, `index.md`, `system/**`, `projects/<id>/system/**`) and `maintaining-deferred-memory` for deferred files (`reference/**`, `projects/<id>/reference/**`, `procedures/**`). Verify the repair before reporting success.

## Current Model

Maintained memory is a private local Git-backed Markdown repository at `~/.gemini/memory/`. Agents never run raw `bash` `git` commands inside `~/.gemini/memory/`; all reads, draft edits, commits, and diagnostics go through the root-bound `agent_memory_*` MCP tools:

```text
~/.gemini/memory/
├── Core.md                              # Always-loaded companion core
├── index.md                             # Always-loaded root index
├── system/                              # Always-loaded global memory
│   ├── persona.md
│   └── human/
│       ├── index.md
│       ├── identity.md
│       └── prefs/
│           ├── index.md
│           ├── coding.md
│           ├── communication.md
│           └── workflow.md
├── reference/                           # Deferred global memory
│   └── index.md
└── projects/
    └── <project-id>/
        ├── index.md
        ├── system/                      # Always-loaded for active project
        │   ├── index.md
        │   ├── overview.md
        │   └── conventions.md
        └── reference/                   # Deferred for active project
            └── index.md
```

Edits staged via `agent_memory_edit` (without `commit: true`) live in an external draft under `~/.gemini/memory.state/drafts/` until `agent_memory_commit` publishes them. Uncommitted draft edits do not alter `[MemFS Active Memory]`. Once `agent_memory_commit` succeeds, the new revision activates on the next `PreInvocation`.

## Start With the Harness Diagnostics

From tool calls, run:

1. `agent_memory_manage({ "action": "status" })` to inspect `revision`, `layoutMode`, `activeDrafts`, and `repositoryState`.
2. `agent_memory_manage({ "action": "doctor" })` to list any broken `[[...]]` links, orphan files, missing `<dir>/index.md` files, or frontmatter issues.

## Resolving CAS & Draft Conflicts

### 1. `HASH_MISMATCH` (`Content hash mismatch`)
Every `agent_memory_edit` call on an existing file requires the file's current `expectedHash` (and `null` when creating a new file).
- **Repair**: Call `agent_memory_read({ "path": "<target-path>" })` to read the latest content and its `hash`, merge your intended change into that latest text, and call `agent_memory_edit` with the fresh `hash`.

### 2. `REVISION_CONFLICT` or `DRAFT_STALE`
If another commit landed while an uncommitted draft was open:
- **Repair**:
  1. Run `agent_memory_manage({ "action": "cleanup" })` to discard the stale draft.
  2. Read the latest committed state of your target file(s) with `agent_memory_read({ "path": "<target-path>" })` to capture the current `hash` and `currentRevision`.
  3. Re-apply your edits cleanly via `agent_memory_edit` and publish with `agent_memory_commit` (or `commit: true`).

### 3. `RETENTION` (`Lossless Retention Guard` rejection)
Protected files (`Core.md`, `system/persona.md`, `system/human/**`, `projects/<id>/system/**`) reject edits that remove a section heading or shrink a file of at least 160 characters by more than 35% unless the same draft commit records the superseded belief in `reference/**`, `projects/<id>/reference/**`, or `archives/**`.
- **Repair**:
  1. In the **same draft** before calling `agent_memory_commit`, write or append the superseded detail/history and rationale into an appropriate `reference/<topic>.md`, `projects/<id>/reference/<topic>.md`, or `archives/<topic>.md` file (and link it in `<dir>/index.md` and `index.md`).
  2. Or, if the edit was only meant to add/refine a fact, keep the existing sections intact and use `mode: "patch"` or `mode: "append"` rather than replacing the whole file with a shorter draft.

### 4. Missing `<dir>/index.md` or Orphan File Warnings
In Tiered v2, every directory containing memory files needs its own `<dir>/index.md` (and every indexable ancestor directory needs an `index.md`), and every deferred file should be linked via `[[path/to/file.md]]`.
- **Repair**:
  1. Run `agent_memory_manage({ "action": "doctor" })` to see the exact `missingDirectoryIndexes`, `orphanFiles`, and `brokenLinks`.
  2. Use `agent_memory_manage({ "action": "migrate-v2", "dryRun": true })` (then `{ "action": "migrate-v2" }`) or `agent_memory_edit(..., { commit: true })` to create missing directory indexes and pointers.
  3. Re-run `agent_memory_manage({ "action": "doctor" })` to confirm `healthy: true`.
