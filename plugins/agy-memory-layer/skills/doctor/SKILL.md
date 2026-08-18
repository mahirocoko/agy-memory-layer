---
name: doctor
description: >-
  Audit MemFS health, check for contradictions between memory rules and actual codebase state,
  detect stale dependencies/conventions, and verify Git repository integrity. Trigger on /doctor,
  /memory-doctor, or "audit memory".
---

# /doctor - MemFS Health & Consistency Auditor

Audits the consistency, validity, and Git health of MemFS against the active workspace.

## Audit Checklist

1. **Git Repository Health**:
   - Check if `~/.gemini/memory/` is a valid git repository.
   - Check for uncommitted changes or merge conflicts.
   - Check commit history cadence.

2. **Project Slug & Memory Resolution**:
   - Verify that the active project matches `~/.gemini/memory/projects/<slug>/`.
   - Verify `project.md` and `rules.md` exist and have valid markdown formatting.

3. **Codebase Reality vs Memory Rules**:
   - Verify mentioned package managers (e.g. `pnpm-lock.yaml`, `bun.lockb`, `package-lock.json`).
   - Check if architectural rules in `project.md` match current file trees.
   - Flag any contradictory or obsolete rules.

## Execution

```bash
WORKSPACE_DIR="$(pwd)"
PROJECT_SLUG=$(basename "$WORKSPACE_DIR" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
MEMORY_ROOT="${HOME}/.gemini/memory"

echo "=== MemFS Health Check ==="
echo "Workspace: $WORKSPACE_DIR"
echo "Project Slug: $PROJECT_SLUG"

if [ -d "$MEMORY_ROOT/.git" ]; then
  echo "✓ Git Repository: OK"
  git -C "$MEMORY_ROOT" status --short
else
  echo "⚠️ Git Repository: Missing! Run install.sh to initialize."
fi
```

## Report Format
Present findings as:
- 🟢 **Healthy Checks**: Git tracking, valid schemas, active links
- 🟡 **Warnings / Drift**: Rules in memory that no longer match the repo
- 🔴 **Action Items**: Recommended removals or updates to run with `/remember` or `/dream`
