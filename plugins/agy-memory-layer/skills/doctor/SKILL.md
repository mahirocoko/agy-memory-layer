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
   - Verify the selected layout has valid active owners: focused `system/**/*.md`
     files with descriptions, or complete legacy fallback files—but never both.

3. **Codebase Reality vs Memory Rules**:
   - Verify mentioned package managers (e.g. `pnpm-lock.yaml`, `bun.lockb`, `package-lock.json`).
   - Check whether active project-system architecture and conventions match the current file tree.
   - Flag any contradictory or obsolete rules.

## Execution

Preferred MCP diagnostics:
- Call `agent_memory_manage` with `action: "doctor"` (inspects Tiered v2 layout mode, `Core.md`/`index.md` completeness, pending external drafts, stale/orphan nodes, and dirty Git state). Use `action: "cleanup"` (`dryRun: true` first) to prune empty stubs or stale external drafts, or `load` `context-doctor` skill for full structural & behavioral investigation guides.

CLI health check:
```bash
node --experimental-strip-types tools/memory-health.ts \
  --memory "${HOME}/.gemini/memory" \
  --workspace "$(pwd)" \
  --strict
```

The deterministic command checks repository state, shared project resolution,
complete project scope, active projection budget, tracked transient residue,
and low-signal learning injection. Follow it with a repo-reality review for
semantic contradictions that a deterministic checker cannot infer safely.

## Report Format
Present findings as:
- 🟢 **Healthy Checks**: Git tracking, valid schemas, active links
- 🟡 **Warnings / Drift**: Rules in memory that no longer match the repo
- 🔴 **Action Items**: Recommended removals or updates to run with `/remember` or `/dream`
