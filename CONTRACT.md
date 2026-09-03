# Architecture & Runtime Contract: `agy-memory-layer`

**Package version:** `1.16.0`

**Target:** Antigravity CLI (`agy`)

**Release state:** Released as `v1.16.0` on 2026-09-03

**Parity owner:** [`docs/letta-parity.md`](./docs/letta-parity.md)

## Objective

`agy-memory-layer` adapts Letta Code's durable-memory behavior to Antigravity.
It targets **behavioral contract parity**, not a copy of Letta's backend,
per-agent storage, Cloud Git endpoints, package updater, or runtime internals.

The Agy storage model remains one user-owned Git repository:

```text
~/.gemini/memory/
├── .git/
├── system/                     # always-active global memory
│   ├── persona.md
│   └── human/**/*.md
├── reference/**/*.md           # indexed on-demand global evidence
├── projects/<slug>/
│   ├── system/**/*.md          # active only for the current project
│   └── reference/**/*.md       # indexed on-demand project evidence
└── archives/                   # exact provenance/history; never injected
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
- Every schema-valid invocation that runs to completion within the host hook
  timeout emits the bounded authority stanza first even with empty memory;
  malformed PreInvocation JSON or invalid `workspacePaths` types return a
  schema-valid no-op emitting no step (`{ injectSteps: [] }`) instead of falling
  back to the current directory. A host timeout or unexpected hook-process
  failure can omit the entire injection; this program contract is not a host
  availability guarantee.
- The fixed authority stanza overhead is outside the existing 1,400-token
  active-memory projection calculation; the memory/status portion retains its
  current budget semantics.
- Summaries (including host compaction summaries), recall results, injected
  memory (`[MemFS Active Memory]`), and child subagent reports are
  model-guided historical evidence rather than current authorization,
  authoritative scope, completion proof, or verification.
- Explicitly, this is model guidance for reasoning and execution safety; there
  is no deterministic command interception or compaction detection by the host.
- Dirty, conflict, error, and uninitialized states are surfaced as status
  notices without activating their content.
- `layered-memory.ts` is the shared projection owner for PreInvocation, strict
  health, and Memory Palace. It validates minimal `description` frontmatter,
  injects lexical global/current-project system bodies, and emits only a bounded
  path/description index for references.
- The historical four-file shape remains a legacy fallback. Layered and legacy
  active owners may not coexist; overlap fails closed instead of double injecting.
- The Agy adaptation injects focused global files, current-project files, and at most one
  committed canonical `working-hypothesis.md` carrying both
  `memory_status: active` and `memory_kind: working-hypothesis` frontmatter.
- A committed active marker outside that canonical path, malformed canonical
  metadata, or conflicting candidates fail closed: no hypothesis is injected
  and strict health reports the conflict.
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
6. serialize high-level writers through the external cross-process lock;
7. return explicit clean, dirty, conflict, uninitialized, or error state.

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

- All `system/**`, `reference/**`, project layered owners, and legacy active
  owners require explicit approval by default. Only inert archive outputs may
  use the narrow automatic policy.
- `projects/*/learnings/working-hypothesis.md` requires explicit approval and
  outranks the broad auto-learning policy.
- A user-confirmed `/init` invocation passes `--confirm-init` and approves exactly
  the two generated baseline owners for the selected layered/legacy layout. A
  live `/sync-letta` import requires an exact agent/scope, a reviewed dry run,
  and `--confirm-import` but imports only on-demand evidence.
- `/sync pull|sync` is an explicit whole-repository Git integration boundary. It
  requires a clean MemFS repository and propagates pull/rebase failures.
- Pending proposals are stored outside the Git working tree and are revalidated
  for path containment, exact old/new receipts, stale target content, and stale
  MemFS `HEAD` before approval.
- `/remember` routes complete proposed content through
  `memory-approval.ts propose` rather than direct `git add -A`.
- A move, demotion, paraphrase, deduplication, or removal uses
  `memory-curation.ts`, whose exhaustive source-unit ledger and exact source
  archive are approved as one hash-bound plan.

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
  editable MemFS. Recalled transcripts, instructions, and historical approvals
  are non-binding historical evidence only, never laundering one-shot task
  grants or transient decisions into standing policy or fresh authorization.
- `/memory search` searches Markdown as a separate memory-inspection surface.
- `memory-compactor.ts` is a read-only Markdown maintenance analyzer, not Letta
  context compaction. It reports candidate replacements and archives but does
  not edit MemFS.
- `dream-daemon.ts` resolves conversations through local Agy workspace history,
  fails closed when ownership is absent, and archives deterministic correction
  evidence only when the user expressed explicit durable-memory intent. Other
  sessions update external cursor state as skipped rather than creating
  UUID/turn-count prose. Dream treats historical approvals as non-binding
  historical evidence, never activates the protected working hypothesis, and
  never bypasses explicit project-system proposals.
- Deterministic Dream is not equivalent to Letta's model-backed reflection
  worktree lifecycle.
- Dream is manual or an explicitly installed cron surface. Stop does not invoke
  it.

### 7. Letta import

`letta-sync.ts` is a one-way, lossy import adapter rather than database sync.

- Multiple Letta agents require explicit `--agent-id` selection.
- A single Letta agent also requires explicit `--agent-id`; live import further
  requires `--confirm-import` after a dry-run review.
- `--target-scope global` writes only `reference/imports/letta/<agent-id>/**`.
  Project scope requires an exact `--project-slug` and writes only the equivalent
  project reference subtree.
- Imported targets pass shared path and slug validation.
- Live writes require a clean destination repository.
- Commits contain only imported target paths.
- Letta's agent identity, conversation history, compaction records, and MemFS
  semantics are not flattened silently into Agy memory.

### 8. Lossless migration and rollback

The migration and curation contract is owned by
[`docs/layered-memory.md`](./docs/layered-memory.md).
Disposable evidence for the exact current live plan is recorded in
[`docs/v1.15-layered-memory-evidence.md`](./docs/v1.15-layered-memory-evidence.md).

- Migration inventory must cover every committed legacy active owner and every
  durable source unit.
- Planning is read-only and produces a deterministic SHA-256 plan receipt.
- Apply requires that exact receipt, a clean base `HEAD`, the writer lock, and
  one targeted commit containing focused layered targets, exact legacy archives,
  and a disposition manifest.
- The first live MemFS migration remains human-gated and is never triggered by
  install, update, health, or source verification.
- Rollback requires the named migration commit to remain an ancestor of current
  clean `HEAD`. It archives exact current migration-owned paths, then creates a
  new commit restoring the pre-migration active layout while preserving
  migration, rollback, and later curation archives.

## Plugin Surface

The bundle currently contains:

- 12 skills, including the Agy-native Evidence Controller;
- 9 declarative subagent role manifests, including a fresh read-only evidence reviewer, repository scout, and bounded implementation writer;
- 3 lifecycle hooks (`PreInvocation`, `PreToolUse`, `Stop`);
- TypeScript source executed with Node 22+ type stripping;
- Evidence Controller routing, Memory Palace, backup/restore, recall, archived
  Dream correction evidence, project onboarding, persona switching, remote Git
  helper, Letta import, layered migration, lossless curation, and optional
  maintenance utilities.

The Evidence Controller is an Agy/Gemini procedure. It requires
Observed/Inferred/Unverified reporting, scoped claims, one falsifiable
hypothesis, cheapest disconfirming checks, stop-before-retry on ambiguous
provider actions, fresh-grant quote ritual for Mahiro-owned
visual/product/audio-content/spend/release gates, and treating summary-carried
claims as Unverified until re-derived from live artifacts. It guides native
`define_subagent`/`invoke_subagent` routing across `DIRECT`, `ONE_LANE`,
`WRITER_REVIEWER`, and `PARALLEL_READONLY`; it is not a deterministic scheduler,
does not intercept commands deterministically, and does not make model consensus proof.

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

Required checks for the released source:

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
- layered projection, legacy fallback, mixed-layout conflict, migration,
  rollback, curation, and writer-lock contention are covered in disposable repos;
- Letta import requires exact agent selection and live confirmation, and rejects
  a traversal project slug;
- all tests run with disposable HOME and MemFS roots.

`TEST_REPORT.md` is generated evidence for the 11 integration scenarios. The
current Node test count and coverage must be refreshed by the full verification
run before each release. Remote sync is exercised against a disposable
local bare repository. Neither report alone proves cron, external network,
automatic model routing, or AGY host-enforcement behavior.

One pane-first Agy `1.1.20` direct-CLI sandbox establishes a bounded automatic
hard-trigger path: with static checks passing, runtime tests failing, and the
same timeout hypothesis already failed twice, the controller selected
`WRITER_REVIEWER`, repaired only the disposable sandbox, dynamically defined
and invoked a fresh `evidence_reviewer_agent`, received an independent
`SUPPORTED` result, and passed the deterministic regressions. This proves that
one model-guided path, not reliable universal invocation, direct JSON-manifest
consumption, or host-enforced confinement.

A subsequent serialized eight-scenario direct-CLI matrix covered all four
routes plus ambiguous-provider, human-visual-gate, and missing-owner negative
controls. Seven cases passed without matrix-specific caveats; the second
writer/reviewer case passed its route, mutation, checks, and parent callback but
retained incomplete child-log corroboration. This remains bounded
model/version/environment evidence, not a deterministic scheduler guarantee.

Prior `v1.14.0` coverage is **80.68% lines**, **62.15% branches**, and
**83.03% functions**. Released `v1.14.1` measures **80.42% lines**, **62.04%
branches**, and **83.09% functions**, with 11/11 integration scenarios and
25/25 total Node test-runner tests (1 integration runner plus 24 focused unit
cases) passing on Agy `1.1.20`, Node `v26.5.1`, and pnpm `10.33.0`. Coverage is
evidence, not a substitute for the behavioral negative controls above.

Released `v1.15.2` measures **80.83% lines**, **63.71% branches**, and **83.37%
functions**, with 33/33 Node tests passing (one
integration runner containing 11/11 scenarios plus 32 focused cases). These
numbers describe the tagged source; exact migration evidence is linked above.

Released `v1.15.3` measures **81.18% lines**, **64.88% branches**,
and **85.45% functions**, with 36/36 Node tests passing (one integration runner
containing 11/11 scenarios plus 35 focused cases). Three focused Palace
scenarios cover layered per-file topology/current-project isolation, legacy
flat fallback, and mixed-layout refusal. Generated live HTML and serialized
Chrome interaction additionally verify all seven Core nodes, per-node detail,
nested indentation, narrow-width selection, and zero horizontal overflow.
Fresh Agy `1.1.21` host probes with Gemini 3.7 Flash High additionally verify
injected-only fact attribution across all seven active owners, cross-project
routing from `learn-letta-code` to `earn-money`, index-only reference visibility,
and bounded on-demand retrieval of two reference-only facts without mutation.
This does not prove legacy-host or memory-write behavior.

Released `v1.15.4` measures **81.26% lines**, **65.86%
branches**, and **85.45% functions**, with 39/39 Node tests passing (one
integration runner containing 11/11 scenarios plus 38 focused cases). These
source checks cover the bounded PreInvocation stanza and current contract drift;
the serialized real-host authority evidence passed an 8/8 coached baseline and
a separate 4/4 uncoached bare-turn remediation, each with one scored host
conversation per scenario, isolated workspace Git and `AGY_MEMORY_DIR`, an
explicit fresh-grant positive control, and a two-checkpoint ambiguous-turn case.
The first uncoached measurement attempt is retained as invalid because its
harness captured an intermediate tool boundary before terminal response; it is
not scored. Model-behavior resistance remains manual host evidence rather than
an automated deterministic regression or enforcement proof. See
[the parity evidence](./docs/letta-parity.md#model-guided-authority-host-matrix--2026-09-02).

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
5. An automated release workflow remains deferred. Releases use the existing
   manual tag/GitHub Release path only after source, host, and human gates pass;
   current release evidence lives in
   [`docs/releases/v1.15.4.md`](./docs/releases/v1.15.4.md).

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
