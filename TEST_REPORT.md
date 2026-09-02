# 🧪 Integration Scenario Report: `agy-memory-layer`

**Date**: 2026-09-02 08:32:02 UTC
**Environment**: macOS (Darwin) · Antigravity CLI 1.1.24 · Node v26.5.1
**Storage Target**: disposable test HOME (isolated from the user's real `~/.gemini/memory/`)
**Scope**: Integration scenarios only; aggregate Node test count and coverage come from `pnpm test` / `pnpm test:coverage` and release evidence.
**Overall Result**: 🟢 **ALL INTEGRATION SCENARIOS PASSED (100%)**

---

## 📊 Summary Scorecard

| Metric | Result |
| :--- | :--- |
| **Total Test Scenarios** | **11** |
| **Passed** | **11** (100%) |
| **Failed** | **0** |
| **Total Execution Time** | **6832 ms** |

---

## 🔬 Detailed Test Results by Subsystem

| Test Suite | Scenario | Status | Time | Verification Evidence |
| :--- | :--- | :---: | :---: | :--- |
| **Hooks Contract** | PreInvocation Hook outputs valid AGY JSON schema | 🟢 PASSED | 1111ms | Valid JSON schema with 1 committed-memory projection step(s). |
| **Hooks Contract** | Stop Hook reports dirty memory without mutating Git state | 🟢 PASSED | 268ms | Verified Stop reports dirty state while preserving HEAD and the working tree. |
| **Workspace Isolation** | Separates Project A and Project B while preserving Global User profile | 🟢 PASSED | 1109ms | Project A and Project B contexts are strictly isolated; Global profile is shared 100%. |
| **Memory Palace** | Palace generator builds interactive HTML with all live projects & git timeline | 🟢 PASSED | 1119ms | Legacy HTML dashboard verified (70 KB) with two real selectable Core paths and no invented project owners. |
| **Git Versioning** | Memory changes can be audited with git log and rolled back cleanly | 🟢 PASSED | 232ms | Successfully proved Git revert and rollback capability. Base hash: 63eb345 |
| **AGY Plugin Schema** | Plugin passes 'agy plugin validate' with zero errors | 🟢 PASSED | 127ms | Native AGY plugin validation: 12 skills, 7 agents, 2 hooks processed with 0 errors. |
| **Proactive Directives** | rules/AGENTS.md keeps proactive learning behind explicit lifecycle boundaries | 🟢 PASSED | 0ms | All 8 proactive and approval-aware directives verified in rules/AGENTS.md. |
| **Codebase Scanner (/init)** | Scans repository architecture and seeds the selected project-memory baseline | 🟢 PASSED | 578ms | Scanner accurately detected React, Vite, TypeScript, Vitest, and seeded Day 1 MemFS blocks. |
| **Memory Search Engine** | Searches across global, project, and historical learnings with ranked snippets | 🟢 PASSED | 329ms | Search engine returned 1 ranked matches in 59.89ms. |
| **Remote Git Sync** | Manages remote URL setup and sync status cleanly | 🟢 PASSED | 761ms | Local bare-remote push/pull passed; dirty MemFS is rejected before network access. |
| **Backup & Integrity** | Exports, verifies SHA-256 signatures, detects tampering, and restores bundle byte-for-byte | 🟢 PASSED | 1198ms | All 7 backup utility tests passed, including checksum integrity and import path containment. |

---

## 🛡️ Verification Proofs & Invariants Guaranteed

1. **Committed Ingestion Contract (`PreInvocation`)**:
   - The Hook delivers committed `HEAD` memory via `injectSteps[].ephemeralMessage` and excludes an uncommitted sentinel.

2. **Day 1 Codebase Scanner (`/init`)**:
   - Analyzes fixture manifests, entry points, linters, scripts, and documentation to seed the selected layered or legacy project baseline deterministically.

3. **Historical Learnings Search (`/memory search`)**:
   - Ranked retrieval returns exact file paths, line numbers, and snippets from the isolated MemFS fixture.

4. **Multi-Device Remote Sync (`/sync`)**:
   - Push, pull, status, setup, and dirty-repository refusal are verified against a disposable local bare remote without external network access.

5. **Explicit Persistence & Non-Mutating Stop**:
   - Targeted writers reject unrelated dirty paths; Stop preserves both `HEAD` and dirty working-tree content while reporting status.

6. **Native Tooling Compatibility**:
   - Verified with `agy plugin validate` (12 skills, 7 declarative agent roles, 2 hooks active).
