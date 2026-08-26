---
name: sync-letta
description: Inspect and explicitly import selected Letta memory Markdown into Antigravity MemFS through contained, targeted commits.
---

# /sync-letta — Explicit Letta Markdown Import

This is a one-way, lossy import adapter. It is not live synchronization and does
not preserve Letta agent identity, conversations, compaction records, or backend
semantics.

## Workflow

### 1. List available stateful agents

```bash
node --experimental-strip-types plugins/agy-memory-layer/scripts/letta-sync.ts list
```

Always ask the user to choose the exact agent and target scope. Even a single
agent requires `--agent-id`; never select a "first" agent silently. Imported
human, rule, and reference Markdown is stored only as on-demand evidence under
`reference/imports/letta/<agent-id>/` or the equivalent project reference path.
The importer never rewrites active human, persona, or project-system owners.

### 2. Inspect the selected raw payload

```bash
node --experimental-strip-types \
  plugins/agy-memory-layer/scripts/letta-sync.ts \
  payload --agent-id <agent-id>
```

Explain which files can be imported and which Letta state will not survive the
adapter.

### 3. Dry-run the exact route

```bash
node --experimental-strip-types \
  plugins/agy-memory-layer/scripts/letta-sync.ts \
  status --dry-run \
  --agent-id <agent-id> \
  --target-scope <global|project> \
  --project-slug <slug-if-project>
```

### 4. Confirm and run live import

After explicit confirmation, repeat the exact command without `--dry-run`.
The destination MemFS repository must be clean. Imported paths are validated and
committed as a targeted set. Add the required `--confirm-import` flag:

```bash
node --experimental-strip-types \
  plugins/agy-memory-layer/scripts/letta-sync.ts \
  sync \
  --agent-id <agent-id> \
  --target-scope <global|project> \
  --project-slug <slug-if-project> \
  --confirm-import
```

## Current Boundary

The script performs contained evidence import, not LLM cognitive grooming. If
imported evidence should become active, prepare a focused layered target and
route it through `memory-curation.ts`; every prior source unit needs a reviewed
disposition and exact archive receipt.
