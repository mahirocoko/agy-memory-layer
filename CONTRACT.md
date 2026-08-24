# Architecture & Runtime Contract: `agy-memory-layer`

**Package version:** `1.13.0`

**Target:** Antigravity CLI (`agy`)

**Release state:** Released as `v1.13.0` on 2026-08-24

**Parity owner:** [`docs/letta-parity.md`](./docs/letta-parity.md)

## Objective

`agy-memory-layer` adapts Letta Code's durable-memory behavior to Antigravity.
It targets **behavioral contract parity**, not a copy of Letta's backend,
per-agent storage, Cloud Git endpoints, package updater, or runtime internals.

The Agy storage model remains one user-owned Git repository:

```text
~/.gemini/memory/
├── .git/
├── global/
│   ├── human.md
│   └── persona.md
└── projects/<slug>/
    ├── project.md
    ├── rules.md
    └── learnings/*.md
└── archives/                 # Git-backed recall-only material; never injected
```

Transient proposal and Dream cursor state lives beside that repository at
`~/.gemini/memory.state/` by default. It is not prompt memory and is not staged
into MemFS commits.

## Required Runtime Contracts

### 1. Committed-memory projection

- `hooks.json` registers `hook-inject-memory.sh` for `PreInvocation`.
- The TypeScript owner, `hook-inject-memory.ts`, reads active content from Git
  `HEAD` through `memory-repository.ts`.
- Working-tree edits are never injected as active memory.
- Dirty, conflict, error, and uninitialized states are surfaced as status
  notices without activating their content.
- The Agy adaptation injects global files, current-project files, and at most one
  committed recent-learning excerpt carrying `memory_status: active` frontmatter.
- Archive paths, legacy uncurated learnings, and deterministic session-continuity
  boilerplate are never active prompt memory. They remain searchable through
  `/memory search` when retained as Markdown under `archives/`.
- The strict offline health threshold is 1,400 estimated tokens. PreInvocation
  remains advisory above that threshold and continues to inject a budget notice
  before every invocation; it does not truncate rules or suppress calls without
  an Agy host persistence contract.

### 2. Explicit, targeted persistence

`memory-repository.ts` is the shared mutation boundary. It must:

1. reject absolute paths, traversal, unsafe slugs, and symlink escapes;
2. require a clean Git repository before a writer starts;
3. write files atomically;
4. reject commits when unrelated dirty paths exist;
5. stage and commit only declared paths;
6. return explicit clean, dirty, conflict, uninitialized, or error state.

The initializer, persona switcher, approval flow, Letta import, deterministic
Dream writer, and backup restore use this boundary. Markdown maintenance is
read-only.

### 3. Non-mutating Stop

`hook-memory-status.sh` and `hook-memory-status.ts` own the `Stop` event.

Stop must never:

- run `git add` or `git commit`;
- delete `.git/index.lock`;
- treat dirty files as approved memory;
- launch Dream or any detached background process.

Stop returns `{"decision":"stop"}` and reports non-clean MemFS state on stderr.

### 4. Review policy

- Global `human.md`, `persona.md`, and dated learnings may use the configured
  auto policy.
- `projects/*/project.md` and `projects/*/rules.md` require explicit approval.
- A user-confirmed `/init` invocation passes `--confirm-init` and approves exactly
  the generated `project.md` and `rules.md` baseline. A live `/sync-letta` import requires an
  exact agent/scope, a reviewed dry run, and `--confirm-import`.
- `/sync pull|sync` is an explicit whole-repository Git integration boundary. It
  requires a clean MemFS repository and propagates pull/rebase failures.
- Pending proposals are stored outside the Git working tree and are revalidated
  for path containment and stale target content before approval.
- `/remember` routes complete proposed content through
  `memory-approval.ts propose` rather than direct `git add -A`.

### 5. Project identity

- Project slugs are lowercase `a-z`, digits, and hyphens, up to 100 characters.
- Project identity preserves an existing committed workspace-basename scope,
  then an existing Git-root scope, then an existing owner/repository scope.
- Without an existing scope, Git workspaces fall back to the normalized Git-root
  basename; non-Git workspaces fall back to the normalized workspace basename.
- Initializer, Dream, and PreInvocation share the same resolver. This keeps an
  explicitly initialized monorepo child scope while preventing generic nested
  paths such as `apps/web` from replacing the repository identity by default.
- User-supplied and imported slugs must pass the same validator.
- Two repositories with the same basename remain a known identity limitation
  until an explicit project registry is introduced.

### 6. Recall, maintenance, and reflection boundaries

- `recall-engine.ts` searches Antigravity conversation transcripts; it is not
  editable MemFS.
- `/memory search` searches Markdown as a separate memory-inspection surface.
- `memory-compactor.ts` is a read-only Markdown maintenance analyzer, not Letta
  context compaction. It reports candidate replacements and archives but does
  not edit MemFS.
- `dream-daemon.ts` resolves conversations through local Agy workspace history,
  fails closed when ownership is absent, and writes a deterministic note only
  when the user expressed explicit durable-memory intent. Other sessions update
  external cursor state as skipped rather than creating UUID/turn-count prose.
- Deterministic Dream is not equivalent to Letta's model-backed reflection
  worktree lifecycle.
- Dream is manual or an explicitly installed cron surface. Stop does not invoke
  it.

### 7. Letta import

`letta-sync.ts` is a one-way, lossy import adapter rather than database sync.

- Multiple Letta agents require explicit `--agent-id` selection.
- A single Letta agent also requires explicit `--agent-id`; live import further
  requires `--confirm-import` after a dry-run review.
- `--target-scope global` writes only `global/*`. Project scope requires an exact
  `--project-slug` and writes only that project's `rules.md` and `learnings/*`.
- Imported targets pass shared path and slug validation.
- Live writes require a clean destination repository.
- Commits contain only imported target paths.
- Letta's agent identity, conversation history, compaction records, and MemFS
  semantics are not flattened silently into Agy memory.

## Plugin Surface

The bundle currently contains:

- 11 skills;
- 6 declarative subagent role manifests;
- 2 lifecycle hooks (`PreInvocation`, `Stop`);
- TypeScript source executed with Node 22+ type stripping;
- Memory Palace, backup/restore, recall, Dream notes, project onboarding,
  persona switching, remote Git helper, Letta import, and optional maintenance
  utilities.

The JSON subagent manifests express role and capability intent. This repository
does not itself prove AGY process/tool confinement; documentation must not call
them sandboxed execution boundaries without host-level evidence.

## Installation and Update Contract

- Root `install.sh` supports local source installation and a remote cached Git
  clone used by the one-line installer.
- Installation initializes MemFS only when needed, creates plugin links, and
  validates committed-memory PreInvocation plus non-mutating Stop.
- `/update` currently refreshes permissions, links, and hook validation from the
  **current source**. It does not download a newer release.
- Install, refresh, and uninstall refuse non-symlink registrations and symlinks
  whose resolved manifest is not `agy-memory-layer`.
- User memory is outside the plugin artifact and must remain intact during a
  normal refresh or uninstall. Normal uninstall removes verified plugin and
  config registration links.
- Complete purge is destructive and remains outside ordinary update behavior.
  It requires a second confirmation flag and an initialized MemFS signature.

## Verification Contract

Required checks for this release:

```bash
pnpm check
pnpm test
pnpm test:coverage
agy plugin validate plugins/agy-memory-layer
```

Current direct regression coverage includes:

- committed-HEAD projection excludes an uncommitted sentinel;
- Stop preserves both HEAD and dirty working-tree content;
- global memory is shared while committed project memory remains isolated;
- absolute/traversal paths and unsafe project slugs are rejected;
- targeted commits reject unrelated dirty paths;
- explicit proposals are contained and approved through a clean repository;
- Letta import requires exact agent selection and live confirmation, and rejects
  a traversal project slug;
- all tests run with disposable HOME and MemFS roots.

`TEST_REPORT.md` is generated evidence for the 11 integration scenarios. The
Node test runner currently reports 23 passing tests, including a disposable-HOME
install/refresh/uninstall/purge lifecycle. Remote sync is exercised against a
disposable local bare repository. Neither report proves cron, external network,
or AGY host-enforcement behavior.

Released `v1.13.0` coverage is **79.31% lines**, **60.73% branches**, and
**81.18% functions**. The released `v1.12.1` candidate measured **77.55%
lines**, **58.46% branches**, and **78.14% functions**. Coverage is evidence,
not a substitute for the behavioral negative controls above.

The real AGY `1.1.16` host E2E also passed committed injection, `/memory`,
targeted `/remember`, scoped `/init`, non-mutating Stop, fresh-session
persistence, and cleanup.
See [`docs/agy-host-e2e-2026-08-20.md`](./docs/agy-host-e2e-2026-08-20.md).

## Deferred Before Production-Ready Parity

1. Isolated Dream/reflection worktree, per-conversation cursor, one-active-run
   lock, merge policy, and activation after successful integration.
2. Source-aware release acquisition, validation, atomic link switch, and
   rollback for remote installations.
3. Built JavaScript artifacts or installed runtime dependencies for remote
   TypeScript-dependent utilities.
4. Host-level proof or narrower claims for subagent tool restrictions.
5. An automated release workflow remains deferred. `v1.13.0` uses the existing
   manual tag/GitHub Release path with exact notes and evidence in
   [`docs/releases/v1.13.0.md`](./docs/releases/v1.13.0.md).

## Distribution

- Repository: `https://github.com/mahirocoko/agy-memory-layer`
- One-line install (no manual clone required):

  ```bash
  curl -fsSL https://raw.githubusercontent.com/mahirocoko/agy-memory-layer/main/install.sh | bash
  ```

- Current source refresh:

  ```bash
  ./plugins/agy-memory-layer/scripts/update.sh
  ```
