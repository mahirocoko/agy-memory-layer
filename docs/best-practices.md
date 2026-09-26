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
- Avoid dumping logs or large snippets into active `system/**/*.md`. Put detailed
  evidence in `reference/` and obsolete/exact source history in `archives/`.
- The active TypeScript hook emits a **Budget Notice** above `32,000` estimated tokens of the aggregate active payload. That gate does not drop active content. The notice is on the final transport step and points to `/doctor` for inspection and curation; deterministic `/dream` does not consolidate the active projection. `memory-health.ts --strict` uses the same pre-chunk payload and excludes the authority stanza, chunk labels, header, and notice.
- Each inject step stays within `40,000` UTF-8 bytes. A disposable Agy 1.2.11 / Opus 4.6 session received one 100,098-character message; the host omitted bytes and recorded `<truncated 51851 bytes>` around the end of `coding.md`, and the workflow tail was NOT VISIBLE. A follow-up probe delivered five ordered byte-bounded messages without transcript truncation, and the model quoted unique tail rules from both `coding.md` and `workflow.md`. This proves the current bounded fixture, not every future host version.
- Only `projects/<slug>/learnings/working-hypothesis.md` can be prompt-active, and it must declare both `memory_status: active` and `memory_kind: working-hypothesis`. The exact path requires explicit approval. Any active marker outside it fails closed. Keep uncurated, superseded, Dream, and historical material under `archives/`, where `/memory search` can still retrieve it.
- Uncommitted Markdown is not active prompt state. Fix or commit it through the shared writer instead of relying on the hook to legitimize it.

---

## 3. Zero Workspace Pollution

- Never write `.md` notes or `.gemini/` folders directly into user projects.
- Memory storage is strictly externalized at `~/.gemini/memory/` and keyed by the shared workspace resolver. Existing child scopes are preserved; otherwise Git-root identity wins over a generic nested basename.
- All user/imported paths must pass `memory-repository.ts` containment and slug validation. Absolute paths, `..`, control characters, and symlink escapes fail closed.
- In non-Git workspaces, the project identity falls back to a normalized basename.

---

## 4. Declarative Subagent Capabilities

- JSON manifests express intended capabilities for roles such as `recall_agent` and `dream_agent`.
- `agent-launcher.ts` resolves those manifests; it does not prove process isolation or host-enforced tool denial.
- Describe a role as sandboxed only after the Agy host execution path has been verified independently.
- Evidence Controller delegation uses native Agy child conversations. Keep one writer, make the reviewer fresh and read-only, disable nested delegation by default, and treat child agreement as evidence input rather than proof.

## 5. Memory Writer Contract

- Start from a clean MemFS repository.
- Declare every path the writer owns.
- Commit only those pathspecs with a concrete reason.
- Refuse unrelated dirty paths rather than staging around them.
- Store pending proposal/cursor state outside the Git working tree.
- Take the shared cross-process lock before any high-level mutation.
- Refuse an existing Git `index.lock` before writing curation targets; inspect
  its owner/age outside the curation path and never delete it automatically.
- Treat moves, demotions, paraphrases, and removals as curation: disposition
  every durable source unit and archive exact source bytes before activation.
- Treat `--confirm-init`, reviewed `--confirm-import`, or verified backup
  restore as approval only for that command's exact declared path set.
