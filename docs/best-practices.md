# Best Practices — `agy-memory-layer`

This guide outlines core development patterns, performance constraints, and memory hygiene rules for `agy-memory-layer`.

---

## 1. Non-Blocking Lifecycle Hooks

- Antigravity lifecycle hooks (`PreInvocation`, `Stop`) must execute within strict latency boundaries.
- **PreInvocation Hook** must complete in `< 100ms` (pure file read and token count).
- **Stop Hook** must perform Git commits instantly and spawn heavy daemon tasks (`dream-daemon.js`) asynchronously via background subshell:
  ```bash
  (node "$DAEMON_SCRIPT" --auto-check >/dev/null 2>&1 &) || true
  ```
- Never perform synchronous network requests or heavy embedding recalculations inside synchronous hook scripts.

---

## 2. Memory Hygiene & Token Budget Guard

- **Compact Signal**: Memory blocks injected into the prompt must be dense, clear, and high-signal Markdown.
- Avoid dumping multi-megabyte log files or large code snippets into `human.md` or `project.md`.
- Use the **Budget Notice** threshold (`> 4,000 tokens`) to prompt dreaming or pruning via `/dream` or `/doctor`.

---

## 3. Zero Workspace Pollution

- Never write `.md` notes or `.gemini/` folders directly into user projects.
- Memory storage is strictly externalized at `~/.gemini/memory/` and keyed by workspace slug (`getProjectSlug()`).
- In case of non-Git workspaces, fallback safely to `path.basename(process.cwd())`.

---

## 4. Subagent Tool Sandboxing

- Read-only agents (`recall_agent`, `history_analyzer_agent`) must **never** be given write tools.
- Write-capable agents (`dream_agent`, `onboarding_agent`, `memory_agent`) should operate strictly within `~/.gemini/memory/`.
