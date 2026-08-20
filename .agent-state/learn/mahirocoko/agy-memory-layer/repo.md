# agy-memory-layer Learning Index

## Source
- **Local source**: `/Users/mahiro/Git/me/sandbox/learn-letta-code`
- **GitHub**: https://github.com/mahirocoko/agy-memory-layer
- **Analyzed state**: current working tree, including uncommitted hook-migration changes

## Explorations

### 2026-08-20 1303 (default)
- [[2026-08-20/1303_ARCHITECTURE|Architecture]]
- [[2026-08-20/1303_CODE-SNIPPETS|Code Snippets]]
- [[2026-08-20/1303_QUICK-REFERENCE|Quick Reference]]

**Key insights**:
1. The project is a filesystem protocol adapter for Antigravity: lifecycle hooks and declarative skills/agents form the control plane, while `~/.gemini/memory/` is the Git-backed data plane.
2. The in-progress shell-to-TypeScript hook migration currently breaks the preferred Stop path because ESM code uses `__filename`; the recorded result is 10/11 scenarios passing.
3. Source, skills, and docs have material contract drift around `.js` versus `.ts`, Node versus Bun, test/skill counts, memory status/sync commands, persona injection, and approval enforcement.
4. The integration test harness is not hermetic: it mutates and commits the real external MemFS, changes remote configuration, creates worktrees, and rewrites `TEST_REPORT.md`.

## Recommended repair order
1. Restore Stop-hook correctness and add isolated lifecycle regression coverage.
2. Make tests default to disposable HOME/MemFS fixtures.
3. Reconcile executable skill/docs contracts with the TypeScript runtime.
4. Centralize slug resolution and clarify whether approval policy is advisory or mandatory.
5. Harden backup import path containment before treating bundles as untrusted input.
