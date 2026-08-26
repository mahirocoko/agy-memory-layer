# Letta Code Behavioral Parity

This document is the canonical map from Letta Code behavior to the
`agy-memory-layer` Antigravity adaptation. Source and executable tests outrank
this file when they disagree.

## Parity Rule

The project targets **contract parity**, not architecture parity:

- preserve Letta's state, scope, commit, reflection, and user-control guarantees;
- keep Agy's host-native plugin hooks and one user-owned layered
  `system/ + reference/ + projects/ + archives/` MemFS repository;
- do not copy Letta Cloud APIs, per-agent Git remotes, package-manager updater,
  or backend-specific prompt compilation literally.

## Current Owner Map

| Contract | Canonical executable owner | Supporting surface |
| --- | --- | --- |
| Memory path containment and Git state | `scripts/memory-repository.ts` | lifecycle tests |
| Active prompt projection and layout selection | `scripts/layered-memory.ts` | PreInvocation, strict health, Palace |
| Working-hypothesis selection | `scripts/active-learning.ts` | PreInvocation, strict health |
| Agy evidence/delegation procedure | `skills/evidence-controller/SKILL.md` | plugin rules, native Agy subagent tools |
| Workspace/project identity | `scripts/workspace-identity.ts` | PreInvocation, `/init`, Dream |
| Stop behavior | `scripts/hook-memory-status.ts` | `hooks.json` |
| Explicit memory review | `scripts/memory-approval.ts` | `/remember` |
| Provenance-preserving curation | `scripts/memory-curation.ts` | `/remember`, `/persona` |
| Legacy-to-layered migration | `scripts/layered-memory-migration.ts` | human-gated CLI |
| Cross-process write serialization | `scripts/memory-write-lock.ts` | high-level writers |
| Project initialization | `scripts/init-project-memory.ts` | `/init` |
| Letta import | `scripts/letta-sync.ts` | `/sync-letta` |
| Explicit-intent transcript-note generation | `scripts/dream-daemon.ts` | `/dream` |
| Package/version intent | `package.json` | `plugin.json`, `CONTRACT.md` |

## Behavior Matrix

| Letta Code behavior | Agy adaptation | Current status |
| --- | --- | --- |
| MemFS ownership is agent-scoped | One user-owned repo with global and stable project scopes | **Intentional adaptation** |
| Local prompt compilation reads committed `HEAD` | PreInvocation reads committed files with `git show HEAD:<path>` | **Implemented** |
| In-context memory stays focused while detail remains discoverable | Global/current-project system bodies are active; reference bodies are replaced by a bounded path/description index | **Released in v1.15.0** |
| Uncommitted memory is not active prompt state | Dirty/conflict status is disclosed without injecting working-tree content | **Implemented** |
| Memory tools require a clean repo and commit selected paths | Shared writer validates containment, serializes high-level writers, rejects unrelated dirt, and commits owned paths; curation adds receipts and exhaustive dispositions | **Implemented adaptation** |
| Post-turn sync never legitimizes arbitrary dirt | Stop reports state and never stages, commits, deletes Git locks, or launches Dream | **Implemented** |
| Recall history is distinct from editable memory | `recall-engine.ts` searches Antigravity brain transcripts; `/memory search` searches Markdown | **Implemented adaptation** |
| Context compaction is distinct from memory maintenance | `memory-compactor.ts` is read-only Markdown maintenance analysis | **Implemented boundary** |
| Reflection uses conversation cursors, one-active-run reservation, isolated worktree, merge policy, and post-merge activation | Deterministic Dream maps local Agy workspace history, writes only actionable explicit durable intent, skips unknown/vague/no-signal sessions, and remains separate from Stop | **Partial — isolated model reflection integration deferred** |
| A main agent can delegate bounded work and freshly verify claims | Evidence Controller guides Agy-native direct, specialist, writer/reviewer, and parallel-read-only routes; one pane-first hard-trigger sandbox automatically selected writer/reviewer and completed a fresh child audit, while routing remains model-guided | **Implemented procedure; bounded host evidence** |
| Subagent tools and memory scope are enforced at launch | JSON manifests currently resolve declarative role/capability intent | **Not established by this repository** |
| Installed package updater checks and acquires a newer release | `/update` refreshes the active link from the current source only | **Acquisition updater deferred** |
| Release artifact contains runtime dependencies | Direct TypeScript execution requires Node 22+ and a developer dependency install for `ts-inspector.ts` | **Packaging gap remains** |

## Active Lifecycle

### PreInvocation

1. Resolve the configured MemFS root and shared child/root/remote project identity.
2. Select layered or legacy fallback ownership; mixed ownership fails closed.
3. Read lexical global/current-project system bodies plus a bounded reference index and at most one canonical protected working hypothesis from committed Git `HEAD`.
4. Fail closed on malformed layered metadata or active markers outside the canonical path.
5. Never inject an uncommitted edit.
6. Add a status notice when the repo is dirty, conflicted, unavailable, or
   uninitialized.

### Memory write

1. Resolve a relative path inside MemFS and reject absolute paths, traversal,
   unsafe slugs, and symlink escapes.
2. Require a clean repository before editing.
3. Take the shared cross-process writer lock.
4. Write atomically.
5. Refuse a commit when any dirty path is outside the writer's declared set.
6. Commit only the owned pathspecs with a concrete reason.

All active system/reference and legacy owners use explicit proposals unless a
bounded command names and confirms an exact generated baseline (`--confirm-init`).
Moves, demotions, and removals require curation receipts and exact archives.
Pending proposal, lock, and Dream cursor state lives beside the repository in
`memory.state/`, not in the prompt or Git working tree.

### Stop

Stop is observational. It returns the AGY `{"decision":"stop"}` response and
reports non-clean state on stderr. It does not approve memory, create snapshots,
repair locks, run Git, or schedule reflection.

## Agy-Specific Features

The following are useful Agy features, not proof of Letta parity:

- project folders and cross-project synapse search;
- local BM25 + n-gram Antigravity transcript recall;
- Memory Palace;
- read-only Markdown maintenance and archival analysis;
- Evidence Controller routing and scoped closeout;
- explicit-intent deterministic Dream correction archives;
- skill candidate synthesis;
- Letta-to-Agy import.
- hash-bound layered migration and provenance-preserving curation.

Letta import requires an exact agent and scope. It writes only on-demand
evidence under `reference/imports/letta/<agent-id>/**` or the equivalent project
reference path; active owners are not rewritten by import.

Each feature needs its own tested contract and must not be presented as an
equivalent Letta subsystem when the semantics differ.

## Deferred Parity Work

1. Add one-active-run locking, a clean memory worktree, model-backed synthesis,
   merge handling, and activation only after successful integration. Current
   deterministic Dream already fails closed on unknown conversation ownership.
2. Implement a source-aware release updater with temporary acquisition,
   validation, atomic link switching, and rollback. Local source checkouts must
   remain user-updated.
3. Prove AGY execution-time tool restrictions for declarative subagent roles or
   narrow those role claims further.
4. Publish runnable JavaScript artifacts or install runtime dependencies so a
   remote installation does not depend on a developer checkout.

## Evidence

- `pnpm test`: integration scenarios plus focused Node test-runner regressions.
- Direct negative controls cover uncommitted projection exclusion, non-mutating
  Stop, path traversal, unrelated dirty paths, targeted commits, mixed-layout
  conflict, lock contention, exhaustive migration/curation ledgers, rollback,
  and Letta project-slug rejection.
- A disposable-HOME lifecycle case covers local install, current-source refresh,
  non-symlink refusal, normal uninstall preservation, and confirmed purge.
- Remote sync uses a disposable local bare repository to prove successful
  push/pull plus dirty-repository refusal without touching a real network remote.
- Source comparison notes live under the local learned-repository evidence at
  `.agent-state/learn/letta-ai/letta-code/2026-08-20/` and are supporting
  evidence, not current runtime owners.
