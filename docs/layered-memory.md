# Layered Memory, Curation, and Migration

This document owns the v1.15 memory layout and the safety protocol for moving
from the historical four-file MemFS shape. The runtime implementation lives in
`layered-memory.ts`; migration and curation are separate reviewed operations.

## Current Reality

Active prompt memory is a deterministic projection of committed Git `HEAD`.
Working-tree edits, pending proposals, reference bodies, archives, and Dream
cursor state are not active.

The preferred layout is:

```text
~/.gemini/memory/
├── .git/
├── system/                              # always-active global memory
│   ├── persona.md
│   └── human/
│       ├── identity.md
│       └── prefs/
│           ├── communication.md
│           ├── coding.md
│           └── workflow.md
├── reference/                           # on-demand global evidence
├── projects/<slug>/
│   ├── system/                          # always-active for this project only
│   │   ├── overview.md
│   │   ├── architecture.md
│   │   ├── conventions.md
│   │   └── gotchas.md
│   └── reference/                       # on-demand project evidence
└── archives/                            # inert history and exact provenance
```

The historical layout remains a read-only compatibility fallback:

```text
global/human.md
global/persona.md
projects/<slug>/project.md
projects/<slug>/rules.md
```

The compiler selects exactly one layout. If a layered global/project owner and
its legacy active owner coexist, projection and strict health fail closed. This
prevents accidental double injection during migration.

## Minimal Metadata

Every layered Markdown file starts with minimal YAML frontmatter:

```markdown
---
description: Stable communication preferences and when they matter.
---
```

Only `description` and optional `read_only: true|false` are accepted. Unknown
keys, duplicate keys, malformed delimiters, missing descriptions, or invalid
booleans fail strict health. The body is injected for system memory; reference
frontmatter supplies the bounded on-demand index.

## Projection Contract

`inspectCommittedMemoryProjection()` and `renderCommittedMemoryProjection()`
are the shared owners for PreInvocation, strict health, and Memory Palace.

1. Read committed files with `git show HEAD:<path>`.
2. Activate global `system/**/*.md` in lexical path order.
3. Activate only `projects/<current-slug>/system/**/*.md`.
4. Render a bounded index of global and current-project references: path plus
   description only, never body text.
5. Exclude `archives/**`, other projects, working-tree edits, and pending state.
6. Append at most one valid canonical working hypothesis under the historical
   protected learning path.
7. Report the selected layout, paths, diagnostics, and estimated token count.

The strict health budget remains 1,400 estimated tokens. Reference-index
entries count toward that budget because they are injected; reference bodies do
not. PreInvocation remains advisory over budget, while `/doctor --strict`
provides the deterministic blocking gate.

## Write and Approval Contract

High-level writers share a cross-process lock stored beside MemFS at
`memory.state/locks/memory-write.lock`. Creation is one atomic `wx` file write,
an existing lock is never stolen or automatically deleted, and release requires
the exact owner token. A stale or unreadable lock fails closed until a human
verifies no writer is alive and removes that one external state file.

All active `system/**`, `reference/**`, and legacy owner updates are explicit by
default. A normal proposal records:

- target path;
- committed base revision;
- exact old and new SHA-256 receipts;
- full diff, author, reason, and creation time.

Approval reacquires the writer lock, rechecks the old content and MemFS `HEAD`,
then writes and commits only the declared path. Rejection only removes transient
proposal state. Stop never approves or mutates anything.

## Lossless Curation

Use `memory-curation.ts` whenever existing durable text is moved, demoted,
paraphrased, deduplicated, or removed. A curation spec names source receipts,
complete targets, and one disposition for every non-empty body unit, including
headings:

- `active` — retained in a system owner;
- `reference` — moved to on-demand evidence;
- `historical` — retained only in the exact archive;
- `duplicate` — represented by another declared target;
- `rejected` — intentionally discarded and valid only with `humanApproved: true`.

Every active/reference/duplicate disposition also declares how the destination
represents it. `exact` requires the original unit as an exact target-body line.
`summary` names one exact `summaryText` line in the target, so the reviewer sees
the source-to-summary mapping rather than trusting a label with unrelated
content. Historical units point to the generated exact archive; rejected units
remain the only human-approved omission route.

Planning and proposing do not mutate MemFS. Approval archives every exact source
blob under `archives/curations/<id>/source/`, writes a hash-bound manifest,
applies targets/removals, and creates one targeted commit. Missing or duplicate
dispositions, stale receipts, stale `HEAD`, invalid destinations, dirty MemFS,
or lock contention fail before activation. The read-only compactor may suggest
changes but cannot bypass this protocol.

## Legacy-to-Layered Migration

`layered-memory-migration.ts` is a stricter one-time transition:

1. `units` inventories every committed legacy active owner and emits SHA-256
   receipts plus durable source-unit IDs.
2. A human-reviewed spec must cover **all** legacy active owners, define focused
   layered targets, and disposition every non-empty body unit, including headings.
3. `plan` validates the exact base `HEAD`, source receipts, frontmatter,
   required global/project owners, and produces a deterministic plan hash.
4. `apply` requires that exact hash. It takes the writer lock, revalidates the
   plan, archives exact legacy files plus a manifest, removes legacy active
   owners, writes layered targets, and creates one commit.
5. Nothing changes when planning fails or the confirmation hash is wrong.

Commands:

```bash
node --experimental-strip-types \
  plugins/agy-memory-layer/scripts/layered-memory-migration.ts \
  units --memory "${HOME}/.gemini/memory"

node --experimental-strip-types \
  plugins/agy-memory-layer/scripts/layered-memory-migration.ts \
  plan --memory "${HOME}/.gemini/memory" --spec /tmp/layered-migration.json

node --experimental-strip-types \
  plugins/agy-memory-layer/scripts/layered-memory-migration.ts \
  apply --memory "${HOME}/.gemini/memory" \
  --spec /tmp/layered-migration.json --confirm-plan <reviewed-plan-sha256>
```

Migration is not an installer side effect. Updating source, refreshing the
plugin link, or running health checks never migrates live memory.

## Rollback

Rollback is additive Git history, not a force reset. It is allowed only while
the exact migration commit is still `HEAD`:

```bash
node --experimental-strip-types \
  plugins/agy-memory-layer/scripts/layered-memory-migration.ts \
  rollback --memory "${HOME}/.gemini/memory" \
  --migration-id <id> --migration-commit <sha>
```

The rollback commit restores the parent active files and removes layered
targets while preserving `archives/migrations/<id>/` and its receipts. If later
memory commits exist, automatic rollback refuses; reconcile them explicitly
rather than erasing intervening history.

## Human Gate for the First Live Migration

Before touching real `~/.gemini/memory`, present:

1. current MemFS `HEAD` and clean status;
2. exact source receipts and complete unit ledger;
3. focused target files and projected token total;
4. deterministic plan hash and changed-path list;
5. disposable-repository apply/rollback evidence;
6. the exact live apply command and rollback command.

Only an explicit approval of that packet authorizes the first live migration.
Release, installed refresh, and migration are separate gates.
