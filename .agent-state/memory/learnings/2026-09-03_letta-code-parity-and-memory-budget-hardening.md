---
artifact: reference-learning
authority: non-canonical
status: candidate
source: .agent-state/memory/retrospectives/2026-09/03/07.12_letta-code-parity-and-memory-budget-hardening.md
---

# Reference Learning: Letta Code Parity, Active Memory Density & Process Resilience

**Date**: 2026-09-03
**Workspace**: `learn-letta-code`
**Source Session**: `2026-09/03/07.12_letta-code-parity-and-memory-budget-hardening.md`

---

### Intent
Ensure durable in-context memory remains within strict token budget thresholds without losing critical invariants, while adopting upstream Letta Code patterns for progressive truncation, process lifecycle management, and architectural layer boundaries.

### Trigger
- Injected MemFS active memory exceeds the 1,400-token ceiling (triggering budget warning notices in prompt context).
- Long conversation transcripts need to be summarized or indexed without overflowing the model context window.
- Background tasks, daemons, or server processes risk being orphaned after terminal disconnection.
- Codebase conventions (such as TypeScript `type` alias only) need automated enforcement in static checks.

### Action
1. **Memory Curation Density**: Use `memory-curation.ts` with explicit summary dispositions and provenance archiving to densify verbose directives into concise, high-signal English rather than expanding system blocks with narrative explanations.
2. **Progressive Middle-Truncation**: Apply `middleTruncateText` (30% head + 30% tail + context dropped marker) across recall vectorization and reflection scanners so both original user intent and final execution conclusions are preserved.
3. **Orphan Process Detection**: Implement parent PID liveness checks (`isProcessAlive`, `startOrphanDetection`) in background workers to gracefully terminate when reparented to PID 1.
4. **Static Layer Boundary Linter**: Add AST checks (`scripts/check-layer-boundaries.ts`) to `pnpm check` to forbid `interface` declarations and prevent lifecycle hooks from importing presentation modules.
5. **Subagent Worktree Wiring**: Connect `agent-launcher.ts` with `worktree-manager.ts` so subagents with write capabilities can execute within isolated Git worktrees.

### Boundary
- Do not bypass `memory-curation.ts` with unreviewed deletions; always preserve exact source files under `archives/curations/`.
- Middle-truncation is reserved for long evidence and historical transcripts; active system rules must remain intact.
- Orphan detection monitors parent liveness without terminating unrelated sibling processes.

### Rationale
Comparing `agy-memory-layer` with `letta-code` upstream revealed that Letta bounds Core Memory to 2,000 characters per block and offloads large context to on-demand filesystem reads. In Antigravity's always-injected model, densifying memory and adopting progressive truncation achieves equivalent resilience without incurring tool-call latency or rule neglect blind spots.
