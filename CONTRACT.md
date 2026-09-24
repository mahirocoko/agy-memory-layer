# Architecture & Runtime Contract: `agy-memory-layer`

**Package version:** `1.21.0`

**Target:** Antigravity CLI (`agy`)

**Release state:** Released as `v1.21.0` on 2026-09-24 for interactive,
human-supervised use

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

#### Approval-bound repository contract alignment

- `/contract-refine` may edit only `AGENTS.md` plus non-historical
  `docs/**/*.md`. Before approval it prepares exact proposed owner bytes outside
  active owners and places the complete sorted path/role/content-hash manifest
  in `proposal.finalOwners`.
- Every first baseline adoption and later contract change requires an explicit
  proposal/approval pair. Git cleanliness or a committed contract is repository
  state, not human acceptance.
- Snapshot creation requires live active-owner identity to equal the approved
  final manifest exactly. Verification binds that manifest, proposal hash,
  selected item IDs, approval locator, compiled source hash, rule digest, and
  embedded ledger. Approval metadata records cooperative evidence; it is not
  cryptographic authentication.
- `/contract-align` evaluates only an already verified snapshot. Every explicit
  target must exist, resolve inside the repository, and be a regular code file
  before content evaluation. Evaluation receipts bind exact target paths and
  bytes; verdict rejects changed targets, changed owners, mismatched review
  hashes, missing evidence, incomplete review, and reported violations.
- A fresh read-only reviewer is required when the current parent authored,
  refined, disputed, or implemented the claim under review. Reviewer output is
  evidence rather than authority or a vote, and recorded reviewer IDs are not
  host-attested identity proof.

#### Atomic confirmation-request gating

- `tool-guard.ts` is a confirmation-request classifier for recognized PreToolUse
  shapes. It denies ambiguous gated bundles, malformed known-tool inputs,
  destructive actions, protected MemFS/Git metadata targets, and unknown Git
  subcommands that may resolve to aliases or external executables.
- One recognized scoped mutation receives `force_ask`; Git mutation reasons bind
  the normalized action text and resolved repository scope. Missing or ambiguous
  repository scope fails closed.
- Conversation, transcript, model, and artifact metadata are context only. The
  guard does not authenticate authorization, issue or verify grants, retain an
  action hash or approval receipt, or treat host confirmation as plugin-owned
  authority. Its shell parser is deliberately bounded and not universal shell
  semantics coverage.

#### Material-claim review packets

- `material-claim-review.ts` validates a bounded subject packet naming each
  material claim, canonical owner, current consumers, failure condition, and
  required evidence kinds. File owners and consumers bind exact current bytes by
  SHA-256 plus required contained text.
- A review packet binds the subject hash, a different `fresh-read-only` reviewer
  conversation, fresh reviewer timestamp, direct evidence for every binding, an
  explicit counterexample probe/outcome, and coherent `pass`, `fail`, or
  `blocked` tuples. Overall `fail` outranks `blocked`, which outranks `pass`.
- Verification rejects stale/tampered bytes, missing evidence, locator
  substitution, symlinks, and paths outside the repository. It validates packet
  shape, current bindings, and declared outcomes; it is not semantic proof and
  cannot establish that a reviewer observed runtime or UI evidence.
- Reviewer identity remains cooperative metadata. Every result reports
  `identityAuthentication: not-authenticated`.

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

### 9. Offline host-evidence receipt store

The `v1.20.0` source contains a POSIX-only test/evidence subsystem for deriving host-evidence aggregates from
immutable persisted receipts. `tools/host-evidence-contract.ts` remains the
canonical owner of manifest, frozen bindings, aggregate evidence, scoring,
hashes, and retrieval accounting. `tools/host-evidence-receipts.ts` owns pure
exact receipt parsing, the closed lifecycle, hash-chain replay/admission, and
aggregate derivation. `tools/host-evidence-store.ts` alone owns filesystem
persistence, cooperative active handles, sealing, and independent verification.
The execution-continuity pilot remains a separate domain and is not imported as
a type or authority.

This subsystem has these formal boundaries:

- It is **offline-only**. Authorization receipts bind descriptor, manifest,
  bindings, owner-lock, and `scope: offline-only`; they never authorize an Agy,
  Herdr, provider, browser, network, trust-automation, child-process, HOME, or
  MemFS action. Tests use only the in-memory fake transport.
- `createRun` alone chooses a fresh direct child of canonical `os.tmpdir()` with
  the fixed `host-evidence-v1-` prefix. It creates and identity-freezes a
  synthetic workspace. There is no caller-selected base, writable import, stale
  lock takeover, PID/timeout reclaim, or unsealed writer reopen path.
- Root/workspace directories are exact mode `0700`; immutable files are exact
  mode `0600`, expected uid/gid, regular, single-link files. Canonical root and
  workspace containment, device/inode identity, symlink/special-file rejection,
  unknown-entry rejection, and bounded canonical JSON are rechecked before use.
- Each canonical file is exact `stableJson(parsedValue)` UTF-8 without a newline.
  Reads open once with no-follow/nonblocking flags where available, validate the
  descriptor before and after a bounded read from that same descriptor, then
  decode, parse, and canonical-check. Append, authorization, and seal publication
  APIs use exclusive creation and durable same-filesystem publication; they never
  overwrite, truncate, repair, or delete an existing file. A partial/inconsistent
  publication poisons the active handle and fails closed. `disposeRun` is the sole
  removal API and removes only the exact active disposable root after the same
  opaque-handle ownership, root identity, and integrity checks pass.
- The immutable owner lock records one cooperative owner/session token and stays
  after logical close. Owner identifiers are coordination labels, not
  authentication. Mutation requires the exact opaque handle present in private
  module state; cloned or forged objects fail. That state pins root identity,
  immutable file inode/size/content hashes, original parsed values, and the
  current receipt count/head. Every mutation rechecks those pins, so suffix
  deletion, coherent active-history rewrite, byte-identical inode replacement,
  foreign lock drift, and externally introduced seal artifacts fail closed.
  Mutations are serialized and sealed runs reject further receipt mutation.
- Authorization precedes attempts. Readiness, optional exact-workspace trust,
  host identity, conversation, structured input, typed effect
  reservation/submission, observations, reconciliation, and close follow the
  closed receipt lifecycle. Attempt/effect reservations consume predictable
  admission budget permanently; retrieval charges both retrieval and aggregate
  tool admission. Effect submission and failure uncertainty are sticky facts:
  only an exact `effect.submitted` marks submission, and later observations or
  reconciliation never erase either fact. Conversation creation, user input,
  tool result, and retrieval result are single-terminal operations whose first
  terminal sequence is retained and whose second terminal result is rejected,
  including while unresolved; planner responses remain a multi-observation drain.
- Effect reconciliation is exact. `completed` requires sticky submission plus
  prior operation-compatible substantive evidence; for a single-terminal
  operation it must cite exactly the retained terminal-result sequence.
  `not-submitted` requires no submission, no substantive or terminal observation,
  and an empty observation list. `unknown` accepts no observation references and
  remains unresolved. Duplicate references and self, future, nonexistent,
  wrong-effect, wrong-attempt, or wrong-operation references are rejected. A
  well-formed terminal result after a before-submission failure remains persisted
  as contradictory adverse evidence but cannot make completion, close, or seal
  successful. A correlated observation arriving after `not-submitted`
  reconciliation is likewise persisted as a permanent contradiction rather
  than discarded. Observed tool and planner-continuation counts come only from exact
  submission receipts, so a valid `not-submitted` reservation is charged but
  contributes no observed call.
- An attempt reconciled `not-submitted` is retired. The same attempt cannot resume
  readiness, trust, host observation, effect work, result/provider/memory drain,
  or another failure; retry requires a newly charged and admitted
  `attempt.reserved`. A failed attempt reconciled `completed` cannot reserve or
  submit new work and may only drain already correlated adverse observations.
  Unknown or unreconciled attempt failure remains blocked as before.
  Attempt reconciliation also preserves the exact failure uncertainty:
  `not-submitted` requires a before-submission failure, while `completed`
  requires an after-submission failure plus unique prior substantive evidence.
- A final response closes admission immediately: no new effect reservation or
  submission may occur afterward. Results and adverse provider/memory facts may
  still drain only from effects that were already submitted before that final.
- Evidence is derived only from a replay value produced by exact validated
  replay. Missing final response is incomplete and never fabricated as
  `UNKNOWN`. The first final is representative while all finals and intermediate
  completions remain counted. Returned UTF-8 bytes, normalized repeated queries,
  and no-progress steps reuse the canonical Phase 1 derivation.
- `sealRun` requires closed observations and no unresolved reservation, derives
  and runtime-parses evidence, computes its own score, and exclusively writes
  evidence, score, and seal. A complete failing score may be sealed; sealed does
  not mean `PASS`. `verifySealedRun` rereads the immutable tree, replays the full
  chain, re-derives and re-scores from frozen artifacts, compares canonical
  bytes, and optionally rejects checkpoint substitution.
- A `host.observed` receipt is the aggregate's live-host-execution observation;
  fake tests therefore use an allow-live-host-observation manifest while the
  fake transport itself performs zero host calls. Arbitrary fake callback audit
  counters are fixture observations, not capability instrumentation or proof.
  Provider action remains a separate sticky fact. Provider request count is
  numeric only when the close receipt declares complete capture visibility;
  provider input bytes are always
  unavailable. Same-stream planner/provider/memory drain observations remain
  visible to the Phase 1 safety and protocol scorer rather than being discarded.
- `scorerHash` still binds a declared frozen value. This store does not establish
  executable scorer provenance, code signing, authenticated owner identity,
  hostile same-UID integrity, or trusted external timestamping. Its local hash
  chain plus active private pins is tamper-evident against inconsistent or
  active-history mutation. A fully coherent same-UID rewrite of an entire stored
  run remains detectable only when verification receives an externally retained
  sealed checkpoint.

This Phase 2 subsystem remains current-source offline evidence infrastructure.
Its descriptor and authorization receipt stay literal `offline-only`; neither
its manifest allow flags nor a sealed score grants a live host action.

### 10. Current-source Phase 3 Direct CLI callback evidence boundary

Current source implements a focused evidence-only adapter owned by
`tools/host-evidence-direct-cli.ts` (strictly under 800 lines) and specified in
[`docs/host-evidence-phase3.md`](./docs/host-evidence-phase3.md).

Ownership is strictly bounded:
- **Direct CLI runtime/lifecycle owner**: The installed Direct CLI workflow at
  `/Users/mahiro/.letta/skills/direct-cli` (especially `scripts/herdr-jobs.py`)
  owns Herdr shell readiness, trust prompt handling, prompt dispatch,
  wait/callback lifecycle, target result collection, and workspace cleanup.
  This repository must not implement a parallel Herdr transport.
- **This repository**: Pure receipt/replay/scoring/checkpoint verifier via
  `tools/host-evidence-direct-cli.ts`. It verifies retained `direct-cli.herdr-job.v2`
  bundles and `direct-cli.callback-message.v1` messages, validates before/after
  repository and MemFS snapshots, translates evidence into Phase 2 immutable
  store receipts, derives scoring, and seals Phase 3 checkpoints. It never spawns
  Herdr or Agy, sends keys/prompts, waits, closes panes/tabs, or mutates Direct
  CLI state.
- **Phase 2 immutable store**: Supporting owner (`tools/host-evidence-store.ts`,
  `tools/host-evidence-receipts.ts`) providing immutable filesystem store,
  append-only receipt hashing, replay verification, run derivation, scoring,
  and sealing.
- **Released v1.19.0**: Historical release baseline strictly preserved without
  rewriting history.

Verification requires a terminal done callback job, single Agy target, matching
working directory, consistent prompt/dispatch hashes, valid target/parent receipts
with stable `agentSession`, pane, workspace, tab, and terminal identifiers, an
accepted `report_ready` callback message with parent acknowledgement, matching
results file bytes, valid `DirectCliCanaryReport` body, and exact before/after
repository and MemFS snapshot invariance.

The Phase 3 regression suite retains **30/30 focused Phase 3 tests** and
**108/108 aggregate host-evidence tests**. Main owns the separately authorized
canary run. This subsystem was developed after `v1.19.0` and released in
`v1.20.0`; it does not amend `v1.19.0` history or become live host proof.

## Plugin Surface

The bundle currently contains:

- 14 skills, including the Agy-native Evidence Controller and approval-bound
  contract refinement/alignment pair;
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
`WRITER_REVIEWER`, and `PARALLEL_READONLY`. Its bounded re-grounding and
fresh-conversation rotation policy is model-guided only: it does not intercept
compaction, persist a mission supervisor, create or rotate conversations
deterministically, guarantee automatic continuation, intercept commands
deterministically, or make model consensus proof.

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
run before each release. The Phase 3 Direct CLI verifier retains 30/30
focused Phase 3 and 108/108 aggregate host-evidence tests. Final `v1.20.0`
release verification on 2026-09-13 passed 206/206 Node tests and 11/11 generated
integration scenarios, with plugin validation at 14 skills, 9 agents, 3 hooks,
and zero errors; aggregate coverage measured 86.56% lines, 74.75% branches, and
90.66% functions. Remote sync is exercised against a disposable local bare
repository. Neither report alone proves cron, external network, automatic model
routing, or AGY host-enforcement behavior.

Released `v1.19.0` measures **83.76% lines**, **70.76% branches**, and
**88.12% functions**, with 80/80 Node tests passing (one integration runner
containing 11/11 scenarios plus 79 focused cases). The contract workflow's
source tests are complemented by one disposable real-Agy refine-to-align run
and fail-closed owner/target drift controls; these remain bounded evidence, not
authenticated approval, reviewer identity, or universal semantic correctness.

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

## Current release readiness boundary

The retained pre-release readiness owner is
[`docs/agy-main-phase4b-readiness-2026-09-13.md`](./docs/agy-main-phase4b-readiness-2026-09-13.md),
with bounded retained evidence under
[`docs/evidence/agy-main-phase4b-canary-2026-09-13/`](./docs/evidence/agy-main-phase4b-canary-2026-09-13/README.md).
The strongest supported verdict is an interactive, human-supervised `v1.20.0`
release, not an unsupervised safety-trusted main. Herdr may report
`done` while its pane still awaits permission, and the reviewer model may not
observe that permission UI; interactive pane supervision remains required.

## Deferred Before Production-Ready Parity

1. Durable mission state, finite completion supervision, compaction recovery,
   and final-response blocking remain unimplemented. The approved
   [`execution-continuity pilot`](./docs/execution-continuity-pilot.md) is a
   design-and-evidence plan, not an active runtime contract or standing provider-call authorization.
   Stage 0 has a reviewed deterministic fixture-preflight PASS. A separately authorized 15-run
   Stage 1 screen then disqualified standalone continuity for stale persisted fingerprints and the
   Letta-led mode for terminal missions with open agent criteria. The corrected test-only scorer now
   rejects both shapes, but no model rerun, Stage 2 repeat, runtime supervisor, OS sandbox, compaction
   recovery, or human-acceptance proof is authorized or implemented.
2. Isolated Dream/reflection worktree, per-conversation cursor, one-active-run
   lock, merge policy, and activation after successful integration.
3. Source-aware release acquisition, validation, atomic link switch, and
   rollback for remote installations.
4. Built JavaScript artifacts or installed runtime dependencies for remote
   TypeScript-dependent utilities.
5. Host-level proof or narrower claims for subagent tool restrictions.
6. An automated release workflow remains deferred. Releases use the existing
   manual tag/GitHub Release path only after source, host, and human gates pass;
   current release evidence lives in
   [`docs/releases/v1.20.0.md`](./docs/releases/v1.20.0.md).

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
