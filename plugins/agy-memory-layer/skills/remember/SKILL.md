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
   WORKSPACE_DIR="$(pwd)"
   PROJECT_SLUG=$(basename "$WORKSPACE_DIR" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
   MEMORY_ROOT="${HOME}/.gemini/memory"
   mkdir -p "${MEMORY_ROOT}/global" "${MEMORY_ROOT}/projects/${PROJECT_SLUG}"
   ```

2. **Update Target File**:
   - Use `replace_file_content` or `write_to_file` to cleanly append or update the rule under the relevant heading.
   - Avoid duplicate or contradictory entries; refine existing statements if needed.

3. **Commit to Git**:
   ```bash
   git -C "$MEMORY_ROOT" add -A
   git -C "$MEMORY_ROOT" commit -m "remember: $(date +%Y-%m-%d) - [brief summary of rule]"
   ```

4. **Confirm to User**:
   - Report the exact file updated and the rule recorded.
