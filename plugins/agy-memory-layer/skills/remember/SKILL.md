---
name: remember
description: >-
  Explicitly record, update, or append a user preference, coding habit, architectural convention,
  or project fact into MemFS. Trigger when user says /remember, "remember that...", "จดจำว่า...",
  or teaches a new permanent rule.
---

# /remember - Record to MemFS

Permanently record a user preference, architectural decision, or convention to Git-backed MemFS at `~/.gemini/memory/`.

## Target Selection

Determine where the new knowledge belongs:

| Scope | Layered target | Example content |
| :--- | :--- | :--- |
| **Human identity** | `system/human/identity.md` | Stable identity and relationship context |
| **Human preference** | `system/human/prefs/<topic>.md` | Communication, coding, or workflow preferences |
| **Agent persona** | `system/persona.md` | Persistent identity, tone, and operating posture |
| **Project core** | `projects/<slug>/system/<topic>.md` | Overview, architecture, conventions, or gotchas |
| **Detailed evidence** | `reference/**` or `projects/<slug>/reference/**` | On-demand examples, history, and long evidence |

Every layered Markdown file needs minimal frontmatter:

```markdown
---
description: What this memory owns and when it is useful.
---
```

`global/human.md`, `global/persona.md`, `projects/<slug>/project.md`, and
`projects/<slug>/rules.md` are read only as a legacy fallback until the reviewed
layered migration removes them. Never create a layered owner beside an active
legacy owner; mixed ownership fails closed.

## Workflow

1. **Resolve Paths**:
   ```bash
   node --experimental-strip-types tools/memory-health.ts \
     --memory "${HOME}/.gemini/memory" \
     --workspace "$(pwd)"
   ```
   Use the reported `projectSlug` and `layoutMode`. Do not derive a slug from the current
   directory basename because initialized monorepo child scopes and Git-root
   scopes intentionally follow the shared resolver.

2. **Prepare Complete Target Content**:
   - Read the committed target, avoid duplicate or contradictory entries, and prepare the complete proposed replacement in a temporary file.
   - Keep stable always-active rules focused. Move long evidence to `reference/` rather than injecting it every turn.
   - All system, reference, and legacy active owners require explicit review.

3. **Route Through the Enforced Approval Boundary**:
   ```bash
   node --experimental-strip-types \
     plugins/agy-memory-layer/scripts/memory-approval.ts \
     propose "projects/<slug>/system/conventions.md" \
     --reason "[brief durable reason]" < /tmp/proposed-memory.md
   ```
   The writer validates containment and the committed base revision. Proposals
   remain outside the Git working tree until approval.

4. **Use Lossless Curation for Moves, Demotions, or Rewrites**:
   A rewrite that removes or paraphrases existing durable units needs a curation
   spec. First inspect source-unit IDs, map every unit to `active`, `reference`,
   `historical`, `duplicate`, or explicitly human-approved `rejected`, then
   propose the deterministic plan:

   ```bash
   node --experimental-strip-types \
     plugins/agy-memory-layer/scripts/memory-curation.ts \
     plan --memory "${HOME}/.gemini/memory" --spec /tmp/curation.json

   node --experimental-strip-types \
     plugins/agy-memory-layer/scripts/memory-curation.ts \
     propose --memory "${HOME}/.gemini/memory" --spec /tmp/curation.json
   ```

   Approval archives exact source blobs plus a receipt manifest before the
   targeted curation commit. Never implement curation as delete-only cleanup.

5. **Confirm to User**:
   - Report the exact target and whether it was committed or is pending approval.
