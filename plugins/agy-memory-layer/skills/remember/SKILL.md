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

| Scope | Target File | Example Content |
| :--- | :--- | :--- |
| **Global User** | `~/.gemini/memory/global/human.md` | General preferences: "Always use Bun instead of npm", "Keep comments in English", "Use -E flag" |
| **Global Persona** | `~/.gemini/memory/global/persona.md` | Agent behavior: "Be concise, avoid fluff", "Pair programming tone" |
| **Project Architecture** | `~/.gemini/memory/projects/<slug>/project.md` | Architecture: "We use Zustand for state", "PostgreSQL schema in /db" |
| **Project Rules** | `~/.gemini/memory/projects/<slug>/rules.md` | Conventions: "Run biome check before commit", "All tests must be collocated" |

## Workflow

1. **Resolve Paths**:
   ```bash
   node --experimental-strip-types tools/memory-health.ts \
     --memory "${HOME}/.gemini/memory" \
     --workspace "$(pwd)"
   ```
   Use the reported `projectSlug`. Do not derive a slug from the current
   directory basename because initialized monorepo child scopes and Git-root
   scopes intentionally follow the shared resolver.

2. **Prepare Complete Target Content**:
   - Read the committed target, avoid duplicate or contradictory entries, and prepare the complete proposed replacement in a temporary file.
   - Global files may follow the configured auto policy. `project.md` and `rules.md` are explicit-review surfaces.

3. **Route Through the Enforced Approval Boundary**:
   ```bash
   node --experimental-strip-types \
     plugins/agy-memory-layer/scripts/memory-approval.ts \
     propose "projects/<slug>/rules.md" \
     --reason "[brief durable reason]" < /tmp/proposed-memory.md
   ```
   The writer validates containment, requires a clean MemFS repository, and commits only the target path in auto mode. Explicit-mode proposals remain outside the Git working tree until approval.

4. **Confirm to User**:
   - Report the exact target and whether it was committed or is pending approval.
