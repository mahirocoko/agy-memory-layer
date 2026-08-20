# Best Practices — `agy-memory-layer`

This guide outlines core development patterns, performance constraints, and memory hygiene rules for `agy-memory-layer`.

---

## 1. Bounded, Non-Mutating Lifecycle Hooks

- Antigravity lifecycle hooks (`PreInvocation`, `Stop`) must execute within strict latency boundaries.
- **PreInvocation Hook** must stay within its registered five-second host timeout and avoid network or heavy compute. It reads active Markdown from committed Git `HEAD`, not from the working tree.
- **Stop Hook** is observational. It may inspect repository state and report it, but must never stage, commit, delete locks, or launch Dream/background work.
- Never perform synchronous network requests or heavy embedding recalculations inside synchronous hook scripts.

---

## 2. Memory Hygiene & Token Budget Guard

- **Compact Signal**: Memory blocks injected into the prompt must be dense, clear, and high-signal Markdown.
- Avoid dumping multi-megabyte log files or large code snippets into `human.md` or `project.md`.
- The active TypeScript hook emits a **Budget Notice** above approximately `1,200` estimated tokens; consolidate through an explicit maintenance or review flow when it appears.
- Uncommitted Markdown is not active prompt state. Fix or commit it through the shared writer instead of relying on the hook to legitimize it.

---

## 3. Zero Workspace Pollution

- Never write `.md` notes or `.gemini/` folders directly into user projects.
- Memory storage is strictly externalized at `~/.gemini/memory/` and keyed by workspace slug (`getProjectSlug()`).
- All user/imported paths must pass `memory-repository.ts` containment and slug validation. Absolute paths, `..`, control characters, and symlink escapes fail closed.
- In non-Git workspaces, the project identity falls back to a normalized basename.

---

## 4. Declarative Subagent Capabilities

- JSON manifests express intended capabilities for roles such as `recall_agent` and `dream_agent`.
- `agent-launcher.ts` resolves those manifests; it does not prove process isolation or host-enforced tool denial.
- Describe a role as sandboxed only after the Agy host execution path has been verified independently.

## 5. Memory Writer Contract

- Start from a clean MemFS repository.
- Declare every path the writer owns.
- Commit only those pathspecs with a concrete reason.
- Refuse unrelated dirty paths rather than staging around them.
- Store pending proposal/cursor state outside the Git working tree.
- Treat `--confirm-init`, reviewed `--confirm-import`, or verified backup
  restore as approval only for that command's exact declared path set.
