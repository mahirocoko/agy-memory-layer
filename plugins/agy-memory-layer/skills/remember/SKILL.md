---
name: remember
description: >-
  Explicitly record, update, or append a user preference, coding habit, architectural convention,
  or project fact into MemFS. Trigger when user says /remember, "remember that...", "จดจำว่า...",
  or teaches a new permanent rule.
---

# /remember - Record to MemFS

Permanently record a user preference, architectural decision, or convention to Git-backed MemFS at `~/.gemini/memory/`.

## Preferred MCP Path (`agent_memory_edit` / `agent_memory_commit` / `agent_memory_manage`)

For fast, atomic, single-step or multi-file Tiered v2 edits when MCP tools are active:
- **Quick single durable fact**: call `agent_memory_manage` with `action: "remember"`, `text`, and optional `path` (automatically resolves CAS `expectedHash` + commits or creates a shared-memory proposal if targeting the shared communication owner).
- **Targeted / surgical edit**: read the target and `index.md` via `agent_memory_read`, then call `agent_memory_edit` (`mode: "patch" | "replace" | "append"`, optional `section`, `expectedHash`, `commit: true` for single-step index auto-sync).
- **Multi-file atomic commit**: omit `commit: true` across `agent_memory_edit` calls to write external drafts in `memory.state/drafts/`, then finalize with `agent_memory_commit`.
- Always respect `read_only: true`, secret checks, Lossless Retention Guard, and explicit review gates.

## Target Selection

Determine where the new knowledge belongs:

| Scope | Layered / Tiered v2 target | Example content |
| :--- | :--- | :--- |
| **Root core** | `Core.md` | High-priority always-loaded core summary |
| **Catalog index** | `index.md` / `<dir>/index.md` | Auto-synced progressive-disclosure catalog |
| **Human identity** | `system/human/identity.md` | Stable identity and relationship context |
| **Human preference** | `system/human/prefs/<topic>.md` | Communication, coding, or workflow preferences |
| **Agent persona** | `system/persona.md` | Persistent identity, tone, and operating posture |
| **Procedures / skills** | `procedures/*.md` | Reusable cross-project step-by-step workflows |
| **Project core** | `projects/<slug>/system/<topic>.md` | Overview, architecture, conventions, or gotchas |
| **Detailed evidence** | `reference/<group>/<topic>.md` or `projects/<slug>/reference/<group>/<topic>.md` | On-demand examples, history, and long evidence |

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

> [!NOTE]
> When the opt-in shared communication adapter (`v1.24.0`) is enabled, updates to `system/human/prefs/communication.md` are automatically diverted to pending proposals in `~/.gemini/memory.state/shared-proposals/` awaiting source review (`shared-memory.ts list|show|export|reject`). Direct writes and commits to the shared owner are prohibited.

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

## Authority and Scope Boundary

This workflow applies the canonical **Authority, Summaries & Historical Evidence Doctrine**
from the plugin rules.

- **Fresh Intent Scope**: A current `/remember` command with explicit content represents fresh durable intent *strictly for that memory content proposal only*. It is never blanket authorization for code commits, git push, package installation, releases, or other human-owned gates.
- **Non-Laundering Rule**: Historical task approvals, temporary grants, and one-shot decisions are non-binding historical evidence. Never promote them into standing policy, system rules, or permanent preferences absent explicit, durable user wording.
