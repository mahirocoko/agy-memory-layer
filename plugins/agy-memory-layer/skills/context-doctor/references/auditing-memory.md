# Auditing memory

A broken link, missing index, or conflicting instruction is direct evidence;
no conversation incident or provider trace is required to diagnose it.

Start with `agent_memory_manage` (`{ "action": "doctor" }`, `{ "action": "palace" }`,
and `{ "action": "status" }`), then inspect relevant file contents and links via
`agent_memory_read` to check:

- **Structure:** required root files (`Core.md`, `index.md`), directory indexes
  (`<dir>/index.md`), YAML frontmatter (`name` and `description` on non-index
  tiered v2 files), and whether any topic is split across fragmented duplicate files.
- **Organization:** duplicate or contradictory facts/instructions, stale content,
  and filenames or descriptions that misrepresent a file's purpose (for example,
  personal facts hidden in a separate `notes.md` instead of `system/human/identity.md`).
- **Discoverability:** broken `[[...]]` links, orphan files not linked from
  `index.md` or `<dir>/index.md`, and deferred memory (`reference/**`,
  `projects/<id>/reference/**`) with no useful request-shaped discovery cue from
  root `index.md` or `<dir>/index.md`.
- **Core-memory size & budget:** which always-loaded files (`Core.md`, `index.md`,
  `system/**`, `projects/<id>/system/**`) dominate the byte/token budget,
  whether detail is duplicated or misplaced, and what must remain in context to
  guide behavior on every turn.

Use bounded inventories and targeted reads (`agent_memory_read`) for large stores;
expand coverage when the requested audit needs it. State which directories and
checks were covered. Conversation history (`continuity_recall`) can help resolve
a stale fact or explain a retrieval failure, but is not a prerequisite for
reporting structural defects.

Respect the Tiered v2 layout:

- **Always-loaded tier:** `Core.md`, `index.md`, non-index `system/**`
  (`system/persona.md`, `system/human/identity.md`, `system/human/prefs/*.md`),
  and the active project's non-index `projects/<id>/system/**` (`overview.md`,
  `conventions.md`).
- **Deferred tier:** `<dir>/index.md`, `reference/**`, `projects/<id>/reference/**`,
  `procedures/**`, and `archives/**`.
- **Index rule:** `Core.md`, root `index.md`, and `<dir>/index.md` have no required
  frontmatter. Non-index tiered files use `name` and `description` frontmatter.
  Every indexed child directory requires its own `<dir>/index.md` and every
  indexable ancestor's `index.md`.

## Repair and verify

Use the root-bound memory-editing workflow (`agent_memory_read` → `agent_memory_edit`
→ `agent_memory_commit`):

1. Read the current target files first via `agent_memory_read` to obtain `hash`
   (`expectedHash`) and `currentRevision`.
2. Fix stale facts at their source, consolidate fragmented files into their
   canonical owner, resolve contradictions and redundant content, and repair
   broken `[[...]]` discovery links in `<dir>/index.md` and root `index.md`.
3. Respect the **Lossless Retention Guard**: protected files (`Core.md`,
   `system/persona.md`, `system/human/**`, `projects/<id>/system/**`) cannot
   remove a section heading or shrink a file of at least 160 characters by more
   than 35% unless the same draft commit records the superseded belief and
   reason in `reference/**`, `projects/<id>/reference/**`, or `archives/**` (or
   `allowShrink: true` is explicitly justified).
4. Commit with `agent_memory_commit` (or `commit: true` on single-file edits),
   citing a concise summary in `message`. If there are no supported fixes, make no commit.
5. After a repair, re-run `agent_memory_manage` (`{ "action": "doctor" }`) to
   confirm `healthy: true` and verify any affected links or indexes.
