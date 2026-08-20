# Best Practices — `agy-memory-layer`

This guide outlines core development patterns, performance constraints, and memory hygiene rules for `agy-memory-layer`.

---

## 1. Non-Blocking Lifecycle Hooks

- Antigravity lifecycle hooks (`PreInvocation`, `Stop`) must execute within strict latency boundaries.
- **PreInvocation Hook** must stay within its registered five-second host timeout and avoid network or heavy compute; current work should remain local file reads, Git metadata, and token estimation.
- **Stop Hook** must commit promptly within its host timeout and spawn heavy daemon tasks (`dream-daemon.ts`) asynchronously via a detached Node process:
  ```bash
  node --experimental-strip-types "$DAEMON_SCRIPT" --auto-check
  ```
- Never perform synchronous network requests or heavy embedding recalculations inside synchronous hook scripts.

---

## 2. Memory Hygiene & Token Budget Guard

- **Compact Signal**: Memory blocks injected into the prompt must be dense, clear, and high-signal Markdown.
- Avoid dumping multi-megabyte log files or large code snippets into `human.md` or `project.md`.
- The active TypeScript hook emits a **Budget Notice** above approximately `1,400` estimated tokens; consolidate via `/dream` or `/doctor` when it appears.

---

## 3. Zero Workspace Pollution

- Never write `.md` notes or `.gemini/` folders directly into user projects.
- Memory storage is strictly externalized at `~/.gemini/memory/` and keyed by workspace slug (`getProjectSlug()`).
- In case of non-Git workspaces, fallback safely to `path.basename(process.cwd())`.

---

## 4. Subagent Tool Sandboxing

- Read-only agents (`recall_agent`, `history_analyzer_agent`) must **never** be given write tools.
- Write-capable agents (`dream_agent`, `onboarding_agent`, `memory_agent`) should operate strictly within `~/.gemini/memory/`.
