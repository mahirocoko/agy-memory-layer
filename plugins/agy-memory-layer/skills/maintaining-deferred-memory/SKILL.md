---
name: maintaining-deferred-memory
description: Maintains deferred memory (reference/**, projects/*/reference/**, and procedures/**), which stores accumulated knowledge, analysis, and observations made by the agent over time. Use when saving detailed reference knowledge (about a project, repository, subsystem, or domain), moving bulky detail out of core memory, or maintaining directory indexes.
---

Deferred memory contains accumulated knowledge that matters only when its subject comes up. If the agent needs the knowledge on most turns (such as user identity, pets, or recurring collaboration preferences), it belongs in core memory: use the `maintaining-core-memory` skill (`system/human/identity.md`, `system/human/prefs/*.md`, `projects/<id>/system/*.md`).

Deferred memory should NOT be used to store:
- Raw interaction logs that can already be looked up via historical recall (`continuity_recall`). Reserve deferred memory for knowledge *derived* and synthesized from experience, organized for progressive disclosure.
- Secrets, tokens, credentials, or `.env` values. Reference secrets by variable name only, such as `$SECRET_NAME`.

## Layout and limits

```text
~/.gemini/memory/
├── Core.md                              # always-loaded companion core
├── index.md                             # always-loaded root index
├── system/
│   ├── persona.md                       # always-loaded agent persona
│   └── human/
│       ├── index.md                     # index for system/human/
│       ├── identity.md                  # always-loaded user identity & personal facts
│       └── prefs/
│           ├── index.md                 # index for system/human/prefs/
│           ├── coding.md                # always-loaded coding preferences
│           ├── communication.md         # always-loaded communication preferences
│           └── workflow.md              # always-loaded workflow preferences
├── reference/
│   ├── index.md                         # index for global deferred references
│   ├── <topic>.md
│   └── <group>/
│       ├── index.md                     # required ancestor index for reference/<group>/
│       └── <topic>.md
├── projects/
│   └── <project-id>/
│       ├── index.md                     # project root index
│       ├── system/
│       │   ├── index.md
│       │   ├── overview.md              # always-loaded for active project
│       │   └── conventions.md           # always-loaded for active project
│       └── reference/
│           ├── index.md                 # index for project deferred references
│           ├── <topic>.md
│           └── <group>/
│               ├── index.md             # required ancestor index for projects/<id>/reference/<group>/
│               └── <topic>.md
└── procedures/
    └── <name>.md                        # reusable operational procedures
```

- Every tiered v2 file (except `Core.md`, `index.md`, and `<dir>/index.md`) starts with YAML frontmatter containing `name` and `description`:

  ```markdown
  ---
  name: deployment-rollbacks
  description: How release rollbacks and migration checks work and when to run them.
  ---
  ```

- `description` states what the file is about so directory listings and palace diagnostics are self-explanatory.
- Name files after their subject (`kebab-case`), not after a date or session.
- Respect `read_only: true` in frontmatter: never modify or remove a read-only file, and never add, change, or remove the `read_only` field.

## Write the indexes

Discovery runs through the `index.md` → `<dir>/index.md` chain and bounded `agent_memory_read` selectors:

- Root `index.md` is always in context, so it must tell the agent what each deferred directory or key reference file contains and when to open it, using the words a future request would use.
- Nested directory indexes (such as `reference/<group>/index.md` or `projects/<id>/reference/index.md`) require each indexable ancestor's `index.md` to exist so `Indexed Memory Directories` can advertise them.
- Link every file that matters from its parent `<dir>/index.md` and root `index.md` using `[[path/to/file.md]] — <request-shaped cue>` rather than relying on blind directory scans.
- After adding, moving, or changing a deferred file, trace the path a future request would take from root `index.md` to the file without already knowing the file path.

## Design for progressive disclosure

Each level should give the agent enough to decide whether to go deeper, and nothing it has to read past to decide:

- Put frequently needed material in `system/**` or `projects/<id>/system/**` and rarely needed detail in `reference/**` or `projects/<id>/reference/**`.
- Keep one authoritative home per subject. Search first with `agent_memory_read` (`{ "query": "<keywords>" }` or `{ "path": "reference" }`) and update the existing file instead of creating a near-duplicate.
- Make each statement stand alone. Name the concrete subject, project, or subsystem instead of writing "it" or "the repo", because a future turn may read only a snippet or page of the file.
- When moving bulky detail or a superseded belief out of a protected `system/**` file into `reference/**` or `projects/<id>/reference/**`, write the detailed reference entry in the **same draft** before calling `agent_memory_commit` so the Lossless Retention Guard is satisfied with full provenance.

## Write analysis, not logs

Recall already returns what happened. A deferred memory file is worth keeping only when it holds what recall cannot: a clear synthesis of a subject, built across events and refined as understanding improves.

- Write the current understanding: how the subsystem or workflow works, the patterns across events, why things failed or succeeded, what to do about it, and any open constraints.
- Revise the file in place when new evidence arrives. Fold the new finding into the analysis; never append a dated incident narrative when one principle explains the pattern.
- Leave out content the agent can cheaply rederive from the repository source of truth: full file contents, command lists, and transient status. Point to the owning repository file instead.

## Commit memory changes

Use only the root-bound `agent_memory_*` MCP tools (`agent_memory_read`, `agent_memory_edit`, `agent_memory_commit`):

1. Search or read existing files first via `agent_memory_read` (`{ "query": "<keywords>" }` or `{ "path": "<target-path>" }`). Queries support Thai/English segmentation and stopword stripping, multi-term coverage, and `|` / `OR` clauses.
2. Create or update the target `reference/**` or `projects/<id>/reference/**` file via `agent_memory_edit` with `expectedHash` (`null` for a new file, or the read `hash` for an existing file). Pass `commit: true` for a single-file edit to auto-sync `<dir>/index.md` and `index.md` links from frontmatter `description` and publish in one step.
3. For multi-file draft edits, update the parent `<dir>/index.md` and root `index.md` in the same draft before calling `agent_memory_commit` (`{ "revision": "<currentRevision>" }`). If a stale draft blocks an edit, run `agent_memory_manage` (`{ "action": "cleanup" }`) before retrying.
