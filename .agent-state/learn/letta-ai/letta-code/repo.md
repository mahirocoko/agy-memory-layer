# letta-code Learning Index

## Source
- **Origin**: ./origin/
- **GitHub**: https://github.com/letta-ai/letta-code

## Explorations

### 2026-09-03 0630 (deep)
- [[2026-09-03/0630_ARCHITECTURE|Architecture]]
- [[2026-09-03/0630_CODE-SNIPPETS|Code Snippets]]
- [[2026-09-03/0630_QUICK-REFERENCE|Quick Reference]]
- [[2026-09-03/0630_TESTING|Testing]]
- [[2026-09-03/0630_API-SURFACE|API Surface]]

**Pinned source**: `28233621` (`0.31.6`)

**Key insights**:
1. **Multi-Protocol & Omnichannel Gateway**: Letta Code v0.31.6 exposes Protocol V2 (80+ commands, 70+ messages) alongside an AppServer WebSocket gateway (`./app-server-client`) and multi-channel gateway (Slack, Telegram, Discord) with reaction-driven approvals, streaming throttles, and OTID disconnection resume.
2. **Context Compaction & Resilient Streaming**: Multi-tier progressive middle-truncation and sliding-window planning prevent token blowup while preserving active tool-call pairs. `drainStream` incorporates terminal EOF guards and stall reconcilers to survive dropped connections without losing agent turn state.
3. **Rigorous Test Isolation & AST Impact Analysis**: 700+ unit tests collocated beside implementation files run via native Bun test runner. Automated AST-based mock isolation checkers (`scripts/check-test-mock-isolation.js`) and environment sandboxing (`AsyncLocalStorage`, temp HOME preloads, `os.homedir` monkey-patching) enforce zero mock leakage across parallel workers.
4. **Architectural Boundaries & Dual Extensibility**: Strict layer boundary enforcement (`tools/` cannot import `cli/`, `providers/` cannot import `agent/`). Combines Claude Code-compatible lifecycle hooks (9 events including pre/post tool use and compaction) with an in-process Mod event fabric and a 4-tier skill discovery hierarchy.

### 2026-08-25 2334 (latest-source layered-memory refresh)
- [[2026-08-25/2334_LETTA-MEMORY-RUNTIME|Memory Runtime]]
- [[2026-08-25/2334_LETTA-CURATION-SAFETY|Curation & Safety]]
- [[2026-08-25/2334_LETTA-TEST-EVIDENCE|Test Evidence]]
- [[2026-08-25/2334_AGY-GAP-ANALYSIS|Agy Gap Analysis]]
- [[2026-08-25/2334_ADAPTATION-DESIGN|v1.15 Adaptation Design]]

**Pinned source**: `1e17af702cb18dd9dd78571846106cd86e9bde24` (`0.30.32`)

**Key insights**:
1. Letta's progressive memory is compiler behavior: committed `system/` content is active while external files are discoverable and read on demand. Directory shape alone provides no routing.
2. Safe curation combines focused owners, surgical edits, explicit descriptions, archive/provenance, and isolated integration. Git recovery alone does not make a lossy rewrite acceptable.
3. Agy should preserve its stronger committed-HEAD, realpath-containment, clean-root, targeted-commit, project-isolation, one-hypothesis, non-mutating Stop, and 1,400-token contracts while adding layered system/reference owners and lossless migration.
4. The `71b62fc` human-memory loss was an intentional rewrite without a destination archive. The v1.15 ledger accounts for every historical fact and later addition before any live migration.

### 2026-08-20 1447 (targeted parity comparison)
- [[2026-08-20/1447_MEMORY-LIFECYCLE-COMPARISON|Memory Lifecycle Comparison]]
- [[2026-08-20/1447_RECALL-REFLECTION-COMPARISON|Recall & Reflection Comparison]]
- [[2026-08-20/1447_PLATFORM-PARITY-DECISIONS|Platform Parity Decisions]]

**Key insights**:
1. `agy-memory-layer` should clone Letta Code's behavioral contracts—committed-revision projection, scoped writes, explicit Git states, transcript cursors, isolated reflection worktrees, and enforced execution boundaries—without copying Letta's backend/API storage layout.
2. Letta Code does support automatic step-count/compaction-triggered reflection, but it scopes work by agent/conversation, reserves one run, rejects dirty parent memory, writes in a worktree, and advances reflection state only after successful integration. Agy's Stop-triggered daemon is directionally related but not equivalent yet.
3. Letta keeps recall history, active prompt memory, context compaction, and reflection as separate systems. Agy currently flattens several of these into one shared project-oriented Markdown repository, so parity decisions must preserve those semantic boundaries even when the Agy storage model remains different.

### 2026-08-18 1043 (deep)
- [[2026-08-18/1043_ARCHITECTURE|Architecture]]
- [[2026-08-18/1043_CODE-SNIPPETS|Code Snippets]]
- [[2026-08-18/1043_QUICK-REFERENCE|Quick Reference]]
- [[2026-08-18/1043_TESTING|Testing]]
- [[2026-08-18/1043_API-SURFACE|API Surface]]

**Key insights**:
1. **Stateful Agent Engine & Dual Memory Paradigm**: Unlike ephemeral coding assistants, Letta Code retains long-term memory across sessions using in-context memory blocks (`persona`, `human`) and Git-backed MemFS (`~/.letta/agents/<id>/memory/`) with automatic pre/post-turn commit & sync routines. It abstracts both Cloud REST and local in-process execution (`@earendil-works/pi-ai`).
2. **Turn Lifecycle State Machine & TurnLease Safety**: Uses a strictly defined lifecycle (`idle` → `command` → `active` → `cancelling` → `settling`) paired with unforgeable `TurnLease` tokens across async boundaries to guarantee race-free execution, message coalescing, and recovery from connection drops.
3. **Omnichannel Gateway, Skills & Kernel Sandboxing**: Ships with a multi-channel gateway (Slack, Discord, Telegram, WhatsApp, Signal), a 4-tier skill discovery hierarchy (Agent, Project, Global, Bundled), hot-reloadable mods, and strict OS-level kernel isolation (Seatbelt on macOS, Bubblewrap on Linux) preventing cross-agent memory traversal.
