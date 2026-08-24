# Letta Code Behavioral Parity

This document is the canonical map from Letta Code behavior to the
`agy-memory-layer` Antigravity adaptation. Source and executable tests outrank
this file when they disagree.

## Parity Rule

The project targets **contract parity**, not architecture parity:

- preserve Letta's state, scope, commit, reflection, and user-control guarantees;
- keep Agy's host-native plugin hooks and one user-owned `global/ + projects/`
  MemFS repository;
- do not copy Letta Cloud APIs, per-agent Git remotes, package-manager updater,
  or backend-specific prompt compilation literally.

## Current Owner Map

| Contract | Canonical executable owner | Supporting surface |
| --- | --- | --- |
| Memory path containment and Git state | `scripts/memory-repository.ts` | lifecycle tests |
| Active prompt projection | `scripts/hook-inject-memory.ts` | `hooks.json` |
| Workspace/project identity | `scripts/workspace-identity.ts` | PreInvocation, `/init`, Dream |
| Stop behavior | `scripts/hook-memory-status.ts` | `hooks.json` |
| Explicit memory review | `scripts/memory-approval.ts` | `/remember` |
| Project initialization | `scripts/init-project-memory.ts` | `/init` |
| Letta import | `scripts/letta-sync.ts` | `/sync-letta` |
| Explicit-intent transcript-note generation | `scripts/dream-daemon.ts` | `/dream` |
| Package/version intent | `package.json` | `plugin.json`, `CONTRACT.md` |

## Behavior Matrix

| Letta Code behavior | Agy adaptation | Current status |
| --- | --- | --- |
| MemFS ownership is agent-scoped | One user-owned repo with global and stable project scopes | **Intentional adaptation** |
| Local prompt compilation reads committed `HEAD` | PreInvocation reads committed files with `git show HEAD:<path>` | **Implemented** |
| Uncommitted memory is not active prompt state | Dirty/conflict status is disclosed without injecting working-tree content | **Implemented** |
| Memory tools require a clean repo and commit selected paths | Shared writer validates root containment, rejects unrelated dirt, and commits owned paths; confirmed `/init`, import, and restore commands own exact declared sets | **Implemented adaptation** |
| Post-turn sync never legitimizes arbitrary dirt | Stop reports state and never stages, commits, deletes Git locks, or launches Dream | **Implemented** |
| Recall history is distinct from editable memory | `recall-engine.ts` searches Antigravity brain transcripts; `/memory search` searches Markdown | **Implemented adaptation** |
| Context compaction is distinct from memory maintenance | `memory-compactor.ts` is read-only Markdown maintenance analysis | **Implemented boundary** |
| Reflection uses conversation cursors, one-active-run reservation, isolated worktree, merge policy, and post-merge activation | Deterministic Dream maps local Agy workspace history, writes only actionable explicit durable intent, skips unknown/vague/no-signal sessions, and remains separate from Stop | **Partial — isolated model reflection integration deferred** |
| Subagent tools and memory scope are enforced at launch | JSON manifests currently resolve declarative role/capability intent | **Not established by this repository** |
| Installed package updater checks and acquires a newer release | `/update` refreshes the active link from the current source only | **Acquisition updater deferred** |
| Release artifact contains runtime dependencies | Direct TypeScript execution requires Node 22+ and a developer dependency install for `ts-inspector.ts` | **Packaging gap remains** |

## Active Lifecycle

### PreInvocation

1. Resolve the configured MemFS root and shared child/root/remote project identity.
2. Read compact global/project content plus at most one explicitly active learning from committed Git `HEAD`.
3. Never inject an uncommitted edit.
4. Add a status notice when the repo is dirty, conflicted, unavailable, or
   uninitialized.

### Memory write

1. Resolve a relative path inside MemFS and reject absolute paths, traversal,
   unsafe slugs, and symlink escapes.
2. Require a clean repository before editing.
3. Write atomically.
4. Refuse a commit when any dirty path is outside the writer's declared set.
5. Commit only the owned pathspecs with a concrete reason.

`project.md` and `rules.md` use explicit proposals unless a user invokes a
bounded command that names and confirms the exact protected output set
(`--confirm-init` or `--confirm-import`). Pending proposal state and Dream cursors live beside
the repository in `memory.state/`, not in the prompt or Git working tree.

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
- explicit-intent deterministic Dream notes;
- skill candidate synthesis;
- Letta-to-Agy import.

Letta import requires an exact agent and scope. Global scope is confined to
`global/*`; project scope also requires a project slug and is confined to that
project's `rules.md` and `learnings/*`.

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
  Stop, path traversal, unrelated dirty paths, targeted commits, and Letta
  project-slug rejection.
- A disposable-HOME lifecycle case covers local install, current-source refresh,
  non-symlink refusal, normal uninstall preservation, and confirmed purge.
- Remote sync uses a disposable local bare repository to prove successful
  push/pull plus dirty-repository refusal without touching a real network remote.
- Source comparison notes live under the local learned-repository evidence at
  `.agent-state/learn/letta-ai/letta-code/2026-08-20/` and are supporting
  evidence, not current runtime owners.
