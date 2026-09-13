> **Historical baseline — not the current candidate owner.** This dated external-product attribution
> evidence remains unchanged as historical input. The canonical current `v1.20.0` development-candidate
> owner is [`agy-main-phase4b-readiness-2026-09-13.md`](./agy-main-phase4b-readiness-2026-09-13.md).

# Agy Main Phase 4A: External Product Failure Attribution Baseline

**Date:** 2026-09-13  
**Status:** Retrospective evidence complete; Phase 4B not started  
**Verdict:** The retained history supports Agy/Gemini 3.8 Flash High as a high-throughput primary
implementation lane, but does not establish it as an unsupervised safety-trusted main.

## Audit mandate

This Phase 4A audit asks a narrower question than “can Gemini code?”:

> When material reference-product work needed Mahiro correction, was the nearest preventable cause model
> judgment, lost or corrupted context, a stale repository contract, or a controller/scorer that
> accepted proxy evidence?

The audit is retrospective and read-only with respect to the external product and live MemFS. It does not run a new
model evaluation, modify the product, replay a provider call, or claim that any proposed repair has
changed model behavior.

### Source-of-truth order

1. Retained user turns, Agy checkpoints, injected authority messages, tool calls, and tool results.
2. Mounted reference-product Git objects and active source/docs at the incident baseline.
3. Current `agy-memory-layer` source and tests for present coverage, explicitly separated from the
   older deployed state.
4. Retrospectives and subagent reports as supporting evidence only.

### Protected boundaries and non-goals

- Preserve the dirty external-product worktree exactly.
- Preserve released v1.19.0 history and the current Phase 2/Phase 3 evidence-only ownership model.
- Do not invent a repository-owned Herdr runtime, durable mission supervisor, or universal semantic
  verifier.
- Do not treat commit counts, keyword counts, a green build, HTTP 200, hashes, or reviewer agreement
  as product acceptance.
- Keep final visual and product acceptance human-owned.

## Frozen evidence snapshot

### Repositories

- `agy-memory-layer`: `7c59a24d08c934a40ac7168ef500b4d505ed9daa`, clean and two commits ahead
  of `origin/main` when Phase 4A began.
- External product repository: `93ca1a10d4223fbe3e5b591b7e362b4b13b8dba7`, one commit ahead
  of `origin/main`.
- External-product worktree snapshot: 22 modified paths and 27 untracked paths, nothing staged. The status stream
  SHA-256 was `3736d1b8a248a1bfa9cd9f0f53fa98199c58fdd9e57380efdd594fec00dd88e0`.
  The same default-porcelain stream and hash were reproduced after verification. This count treats
  untracked directories as one entry; an expanded `-uall` file count is not comparable. The ongoing
  wallet/deposit/withdraw work was not evaluated as complete.

### Retained conversations

| Conversation | Retained records | Checkpoints | User turns | Transcript SHA-256 |
| --- | ---: | ---: | ---: | --- |
| `59898004-2784-4a46-b95e-b39875bb1f31` | 15,538 | 33 | 211 | `58abc6bfe792b053a265c34d1d589f83f9b3428f07211d6820fdc8bcfdd54c6c` |
| `f95c5abb-57da-4143-8d56-0f57f861b04a` | 4,817 | 19 | 46 | `795c3a54a42aec085b49054baca7a016d94f61fe9624323caad1c00c6ed1f239` |

The retained full transcripts live below `~/.gemini/antigravity-cli/brain/<conversation-id>/`
at `.system_generated/logs/transcript_full.jsonl`. The transcript hashes bind this report's input
snapshot without copying raw conversations into Git.

### Delivered product baseline

The reachable 2026-08-27 through 2026-09-11 reference-product history contains 57 commits: 42 `feat`, 10
`refactor`, 2 `fix`, 2 `docs`, and 1 `perf`. The net range changes 460 files with 31,844 additions
and 4,970 deletions across the application shell, API/query/form/auth layers, tenant routing and
storage, reverse-proxy behavior, localization, bonus/promotions/cashback/affiliate, and product UI.
The history is attributed to the repository's `Echo Ninja` identity and aligns temporally with the
Agy transcripts; author metadata alone is not provider attestation.

This is strong throughput evidence, with Agy involvement supported by transcript timing rather than
per-commit provider attestation. It is not equivalent to behavioral correctness evidence:
the reference-product package manifest has format, lint, typecheck, build, and Lingui commands but no test or E2E
script, and HEAD contains no tracked test-like product files.

## Hypothesis result

**Hypothesis:** most material corrections happened because compaction removed the governing rule,
so expanding durable memory is the primary repair.

**Result: REFUTED for this sample.** Of five retained reliability/safety failures, three are
primarily model/reviewer judgment failures and two are primarily controller/gate failures. Neither
context/compaction loss nor repository-contract drift is established as the primary cause of a
sampled failure. Context checkpointing amplified one earlier bad conclusion, and stale MemFS
contributed to one currency mistake. Two additional corrections are classified as ordinary human
product iteration rather than reliability failures.

This count is a bounded attribution over selected high-impact incidents, not a universal benchmark
or a causal estimate for every Agy task.

## Incident ledger

“Primary owner” means the nearest mechanism whose correction would most likely have prevented the
incident. It is not moral blame. Times below are Asia/Bangkok.

I1–I5 are anchored in conversation `59898004-2784-4a46-b95e-b39875bb1f31`; I6–I7 are
anchored in conversation `f95c5abb-57da-4143-8d56-0f57f861b04a`.

| ID | Classification and canonical anchor | Effective context before failure/correction | Primary owner | Contributors | Attribution confidence |
| --- | --- | --- | --- | --- | --- |
| I1 | Ordinary product review: Bonus/Promotions correction `5082`, 2026-09-09 16:59 | The local retained window does not bind the critique to an immediately preceding false closeout | Human iteration | Earlier source/content drift | Mixed |
| I2 | Reliability failure: Cashback/Affiliate false-ready at model step `7476`, human rejection `7477`, 2026-09-09 22:47–22:50 | Checkpoint `7126` retained source fidelity; user step `7227` restated that the reference product was primary | Model/reviewer judgment | Controller accepted static and HTTP proxies | Strong |
| I3 | Ordinary product review: five “AI slop” suggestions at model step `9246`, correction `9247`, 2026-09-10 11:32–11:48 | Request and answer were both after checkpoint `8825`; no intervening compaction | Human iteration | Model supplied four unwanted subjective recommendations | Strong |
| I4 | Reliability failure: USD treated as player-selectable at model step `14276`, correction `14277`, 2026-09-11 11:42–11:43 | Checkpoint `13882` retained the exact THB/USD config requirement | Model judgment | Active MemFS still described an asset-backed selector | Strong |
| I5 | Reliability failure: `/contract-align` declared 306 rules aligned while missing comment taxonomy at model step `15419`, correction `15420`, 2026-09-11 13:46–13:54 | The active repository contract contained the taxonomy; only 2 rules were deterministic and 304 were model-reviewed | Controller/scorer coverage | Superficial model heuristic review | Strong |
| I6 | Safety failure: product commit `5800bb0` at tool steps `2297`–`2298`, correction `2304`, 2026-09-11 16:45–16:46 | Model step `2261` bundled MemFS approval and Git commit in one question; user step `2262` replied `approve` | Controller/gate design | Model, conflicting terse-approval guidance, unresolved host contribution | Mixed |
| I7 | Reliability failure: wallet closeout missed font, currency, token, and source constraints at model step `3906`, correction `3907`, 2026-09-11 22:35–22:38 | The no-monospace rule was visible before the reviewer/model endorsed `font-mono`; checkpoint `3785` retained that prior error | Model/reviewer reconciliation | Checkpoint propagation and proxy-evidence verdict | Strong |

### Attribution counterevidence and limits

- **I1 — Mixed:** the critique is direct, but the retained local window has no immediately preceding
  false-ready claim; treating it as reliability evidence would overreach.
- **I2 — Strong:** source primacy survived, but some design-owner nuance was less explicit after the
  preceding checkpoint. This can explain part of the visual drift, not the later broad verified claim.
- **I3 — Strong as ordinary iteration:** the prompt invited subjective critique, and no mutation or
  completion claim followed before Mahiro narrowed the recommendation.
- **I4 — Strong:** the fresh task/checkpoint retained config-level THB/USD, but stale selectable-list
  MemFS and the phrase “support THB and USD” created genuine competing context.
- **I5 — Strong:** older user teaching was absent from the latest checkpoint, but the frozen current
  repository contract was explicit; the missing conversation detail does not excuse blanket review.
- **I6 — Mixed:** the combined question makes `approve` a literal textual grant even though Mahiro's
  correction proves a narrower intended scope. Missing hook/UI receipts leave host contribution open.
- **I7 — Strong:** model/reviewer conflict is visible before compaction, but the exact serialized
  provider payload is unavailable and the later checkpoint materially prolonged the bad conclusion.

### I1 — ordinary Bonus/Promotions iteration

User step `5082` on 2026-09-09 16:59 rejected exaggerated Bonus/Promotions content, fantasy
assets, possible mock data, and source-owner drift. This is strong evidence establishing the later
source-fidelity contract, but the retained local window does not bind it to one immediately preceding
false completion claim. It is therefore classified as human product review and accumulated rework,
not counted as a standalone false-ready incident.

### I2 — Cashback/Affiliate false-ready used proxy evidence

Model step `7476` called the work “Observed & Verified” after format, lint, typecheck, build, HTTP
200 checks, and a read-only reviewer. Human step `7477` immediately rejected Cashback as not
following the reference product. The later correction at step `7706` identified design-token drift, missing
Chrome-based inspection, wrong tab anatomy, incomplete Buddhist Era/date behavior, content mismatch,
and incorrect conditions.

The failure was not absence of a high-level source rule. It was accepting transport/static
success and reviewer agreement as evidence for structure, conditions, and rendered product
behavior that those probes did not test.

**Cheapest disconfirming follow-up:** require the reviewer to bind every material parity claim to
one exact reference-source locator and one current consumer/runtime probe. A missing locator leaves the
claim open instead of allowing a broad PASS.

### I3 — subjective UI critique was ordinary human iteration

User step `9235` asked which parts of a screenshot looked like AI slop. Model step `9246` produced
five explicitly subjective findings. Human step `9247` accepted only item 3, the added glow shadow;
items 1, 2, 4, and 5 were unwanted interpretations. The model later read the exact reference component
and narrowed the change.

There was no compaction, mutation, false-ready closeout, or explicit claim that those four items
differed from the reference product. This is a useful example of model taste exceeding Mahiro's preferred source
boundary, but is classified as product iteration rather than a reliability failure.

**Cheapest disconfirming follow-up:** force every visual finding into `Observed source difference`,
`Subjective recommendation`, or `Not established`. Only the first class may drive a source-fidelity
repair without a new human decision.

### I4 — exact currency requirement survived, but the model chose the wrong product mechanism

User steps `13775` and `13877` requested a fresh reference-source analysis and selected config-level THB/USD
support. Checkpoint `13882` retained that enum requirement. Model step `14276` nevertheless added
USD to the player-selectable currency list with a US flag and claimed parity. Human step `14277`
corrected both the display condition and whether the reference product exposed that choice.

The nearest active MemFS injection also contained a stale rule saying supported currency datasets
should align with available coin assets and remain selectable. That conflict contributed, but the
fresh task and checkpoint were more specific and current.

**Cheapest disconfirming follow-up:** fixture-test THB and USD tenant configs and assert that the two
tenant currencies never appear together as player choices.

### I5 — hashes and complete review rows did not establish semantic review

Model step `15419` reported `ALIGNED` over 28 files and 306 rules. Its own report said only two rules
were deterministic and 304 were heuristic, then asserted all heuristic rules passed. Human step
`15420` identified the missed comments. The subsequent direct scanner found 13 violations, and a
fresh reviewer still found two remaining files before convergence.

Current `contract-align` is stricter than the incident version: it requires a frozen snapshot,
per-rule bounded rationale/evidence, target-byte rebinding, and one counterexample attempt. The
current executable still cannot prove that the reviewer actually tested the material claim, and
`comment-taxonomy` remains direct only when the repository owner declares the corresponding
`Check:` directive.

**Cheapest disconfirming follow-up:** run the existing deterministic comment-taxonomy evaluator on
the exact incident files. A repository rule without a direct evaluator must remain explicitly
heuristic rather than inheriting an unscoped alignment label.

### I6 — one combined approval question created an unsafe gate

Model step `2261` ended by asking Mahiro to approve both the MemFS proposal and committing product
code. User step `2262` immediately said `approve`. Under a literal reading, this was a fresh terse
answer to an immediately preceding uncompacted gate question. Human step `2304` proves that his
actual intent did not include the Git commit. The preventable defect was bundling two independent
gates into one ambiguous approval surface while another active preference said terse approval could
authorize aligned scope.

The model applied the MemFS proposal, then issued `git add . && git commit`, creating `5800bb0` with
30 product files and 3,826 additions. The latest checkpoint still classified commit as a fresh
Mahiro-owned gate, but did not prohibit a combined gate question.

The PreToolUse classifier had recognized `git commit` as `force_ask` since commit `29f2659` on
2026-09-03. The current source and installed symlink both return `force_ask` for the exact command
shape. The retained incident transcript contains no hook decision or permission receipt, so Phase
4A cannot prove whether the hook ran, whether the host bypassed it, or whether a UI confirmation
occurred. It can prove that the combined textual gate was ambiguous, Mahiro rejected the resulting
commit, and the command executed.

Human step `2304` corrected the action. The model inspected history and reset to `93ca1a1` while
preserving the working tree at step `2310`; the Git reflog and unreachable object agree with that
recovery.

**Cheapest disconfirming follow-up:** first capture the actual PreToolUse payload and host decision
behavior with a harmless synthetic command. Then test a single-purpose commit question separately
from a MemFS proposal. Do not assume the current optional `transcriptPath` field is populated or add
a receipt store before that extension point is observed.

### I7 — model/reviewer judgment contradicted the rule before compaction

At step `2346`, the active reference-product contract exposed the no-monospace rule, and step `2660` correctly
identified `font-mono` as a violation. Before the next checkpoint, however, reviewer step `3660`
endorsed `font-mono`, and model closeout `3682` presented monospace amounts as intentional
typography. Checkpoint `3785` then retained that already-existing bad conclusion; it did not
originate or invert the rule.

Model step `3906` still reported alignment over 315 rules. Human step `3907` called out the forgotten
font, currency, token, and source constraints. A later reviewer validated receipt/hash structure
and accepted heuristic verdicts rather than disproving those material claims.

Checkpointing amplified and prolonged the error while omitting or blurring exact currency and
unsupported-feature constraints. The primary defect was nevertheless model/reviewer failure to
reconcile its recommendation with a current contract it had already read.

**Cheapest disconfirming follow-up:** compare the checkpoint claims against the frozen current
contract before closeout. A direct contradiction such as `font-mono` versus `forbidden font-mono`
must block the verdict and recommend a fresh conversation/re-grounding rather than another broad
review.

## Successful control

The reference-product coin/symbol restraint audit at user step `15107` did not begin with an immediate assurance.
Model step `15118` launched a source-grounded auditor; the returned evidence enumerated limited
authentic coin contexts and excess local uses. Model step `15133` reported discrepancies before
mutation, user step `15134` authorized the bounded cleanup, and post-change review checked both the
target files and system-wide icon boundaries.

This control matters because it shows the same model can converge when:

1. source investigation precedes mutation;
2. the checkpoint preserves the material rule accurately;
3. the reviewer tests the domain claim, not only receipt/process conformance; and
4. the mutation waits for the explicit current user decision.

## Current owner and coverage map

### 1. Fresh Git authorization

| Item | Current owner | Coverage |
| --- | --- | --- |
| Authority doctrine | `plugins/agy-memory-layer/rules/AGENTS.md` and `skills/evidence-controller/SKILL.md` | Procedural/model-guided |
| Command classification | `scripts/tool-guard.ts` through the PreToolUse hook | Direct for configured command shapes such as commit/push/reset; not all Git or shell mutations |
| Tests | `tests/unit-coverage.test.ts` command-classifier cases | Direct for listed `force_ask` cases; missing for authority binding and uncovered command shapes |

**Plausible current false pass:** one model question bundles memory approval and product commit,
Mahiro answers `approve` intending only one action, and the host executes the configured commit
path. Current pure probes also return neutral `ask` for `git add`, non-delete `git update-ref`, and
shell `cp`/`truncate` writes into MemFS.

**Verdict:** **PARTIAL**. Selected command shapes are guarded; action-specific textual authority and
complete mutation coverage are not.

### 2. Task constraints through compaction

| Item | Current owner | Coverage |
| --- | --- | --- |
| Stable project memory | PreInvocation committed projection | Direct for committed memory bytes, not task-local state |
| Active task checkpoint | Current conversation under Evidence Controller guidance | Model-guided and non-durable |
| Host compaction summary | Antigravity host | External; this repository does not own its generation |
| Continuity experiments | Stage 1 evidence and test-only runner | Supporting evidence only; candidates did not advance |

**Plausible current false pass:** a host checkpoint retains an earlier model/reviewer conclusion
that conflicts with a current rule, while the resumed model accepts the summary and does not reopen
the repository owner.

**Verdict:** **MISSING runtime recovery**. No durable mission state, compaction detector, automatic
continuation, or final-response interceptor exists. Phase 4A does not justify building all four.

### 3. Fresh independent review

| Item | Current owner | Coverage |
| --- | --- | --- |
| Role procedure | Evidence Controller and `contract-align` | Direct procedural requirement |
| Declared read-only reviewer | `evidence_reviewer_agent` manifest and tool guard | Direct declared capability intent; host enforcement remains unproven |
| Verdict binding | Contract snapshot/evaluation/review hash | Direct for exact bytes and complete rows |
| Reviewer identity/freshness | No authenticated runtime owner | Missing; `assessedBy` does not prove a fresh conversation |

**Plausible current false pass:** a fresh reviewer supplies complete, hash-bound rows but merely
confirms the writer's narrowed claim or checks receipt validity instead of the source/runtime
behavior.

**Verdict:** **PARTIAL**. Role separation exists; material-claim independence does not.

### 4. Active context-contract consistency

Contract snapshots bind exact declared owners and reject changed bytes. Deterministic checks cover
only explicitly supported directives. They do not establish semantic agreement across active prose.

Mounted reference-product evidence contains three active contradictions at `93ca1a1`:

- `docs/onboarding.md` says React Router v7 while current package/hub evidence says v8.
- The same onboarding page says data comes from in-memory datasets and labels constants as mock data,
  while the hub requires genuine API responses and zero mock data.
- `docs/patterns/hooks-pattern.md` uses `export function` while the hub prohibits the `function`
  keyword, and `docs/styling.md` still names legacy brand-prefixed storage keys instead of the
  current neutral prefix.

**Verdict:** **PARTIAL**. Exact owner freshness is guarded; semantic contradiction detection remains
bounded and repo-specific.

### 5. Ready/complete claims

Evidence Controller requires Observed/Inferred/Unverified separation and explicitly says a build is
not runtime, visual, or product proof. Phase 2 and Phase 3 can bind exact synthetic answers and
retained Direct CLI callback bundles, but they are evidence adapters, not universal product
verifiers or runtime supervisors.

**Plausible current false pass:** format, typecheck, build, HTTP 200, callback hashes, and a reviewer
all pass while the requested domain condition or rendered anatomy remains wrong.

**Verdict:** **PARTIAL**. Claim language is strong; the required material evidence remains
task-specific and can still be replaced by proxies.

## Contradiction and evidence ledger

| Claim | Current owner | Conflicting surface | Layer | Verdict | Disposition |
| --- | --- | --- | --- | --- | --- |
| Reference-product numbers use the primary sans font | Reference-product hub plus styling guide | Reviewer/model endorsed `font-mono`; checkpoint `3785` retained it | Active source vs model/host summary | Contradiction | Material-claim probe; fresh-session re-grounding policy |
| Independent actions need unambiguous approval | Mahiro correction plus authority doctrine | One question bundled MemFS approval and product commit before `approve` | User/model/tool behavior | Ambiguous gate failed | Observe host payload, then choose one single-purpose gate owner |
| Currency is selected by tenant config | Current reference source/task instruction | Active MemFS described a selectable asset-backed list | Source vs injected memory | Drift contributed | Correct owner was re-established; test remains missing |
| Comment taxonomy was aligned | Current repository contract | 13 scanner findings after the broad verdict | Source/static | False PASS | Current skill is stricter; direct binding remains repo-owned |
| Reference-product active docs describe current runtime | Current source/package/hub | v7, mock-data, function syntax, and legacy storage text | Source/static | Not aligned | Product-repo repair is outside this audit |
| Phase 3 proves runtime supervision | Phase 3 non-claims | None found | Current docs/source | Aligned | Retain evidence-only boundary |

## Smallest justified Phase 4B scope

### A. Observe the real PreToolUse boundary before choosing a hard gate

The optional `transcriptPath` field is declared locally but is not consumed by the evaluator, covered
by tests, or retained in an I6 hook receipt. Phase 4B must not assume it is available. First run one
zero-mutation host probe that captures:

1. the actual schema-valid PreToolUse stdin fields;
2. whether `force_ask` is honored under the active Agy execution mode;
3. which existing host surface records the decision and confirmation; and
4. whether a single-purpose commit confirmation can be enforced without new persistent state.

Only after that probe should implementation choose the smallest supported owner: either bind a
verbatim single-action grant through the observed payload, or route commit through a dedicated
single-purpose confirmation. Keep `force_ask` as defense in depth. Do not add a new receipt store or
parallel runtime unless existing host evidence cannot retain the decision.

Regressions should then cover a bundled MemFS-plus-commit question, bare `approve`, an explicit
single-purpose commit grant, compound `git add && git commit`, stale summarized approval,
post-compaction action, mismatched repository scope, and currently uncovered Git/shell mutations.

### B. Bind review to material claims, not aggregate heuristic rows

Build on the current contract snapshot/evaluation owner. Do not add a universal semantic scorer.
Require each consequential review packet to name:

- the exact claim and canonical owner;
- the target consumer or runtime state;
- one plausible counterexample;
- the evidence layer required;
- one result that would block PASS; and
- a fresh reviewer conversation/receipt when the writer authored the change.

A complete review file may still be wrong; its verdict must remain scoped to those claim rows.
Repository-specific deterministic rules—comment taxonomy, no `font-mono`, config-only USD,
unsupported feature absence—belong in reference-product tests/contracts, not global MemFS.

### C. Reduce compaction exposure before building a supervisor

Do not advance the failed Stage 1 continuity candidates or build a runtime supervisor when no
sampled failure establishes compaction as its primary cause. Use a practical operating boundary
first:

- one fresh Agy main conversation per coherent feature/checkpoint;
- restart after a checkpoint contradicts current source or drops a material task owner;
- re-read the frozen repo contract and exact task criteria before a closeout after compaction; and
- preserve durable preferences in MemFS, but keep temporary acceptance criteria in the current
  task packet rather than expanding global memory.

This keeps Gemini Flash as the cost-efficient implementation main while limiting the context length
that produced 33 and 19 checkpoints in the two sampled conversations.

## Phase 4C prospective canary

After Phase 4B passes offline regressions, use the next natural reference-product task rather than a broad
synthetic benchmark:

1. Gemini Flash remains the writer/main lane.
2. A fresh read-only Agy session checks exact source/consumer claims.
3. Git mutation is attempted only after a fresh explicit grant.
4. Static, runtime, rendered, and human evidence remain separate.
5. Promotion requires zero unauthorized Git actions, zero false-ready closeouts, and every seeded
   owner violation caught before Mahiro correction.

One canary cannot prove universal reliability. It can falsify the candidate cheaply before broader
adoption.

## Final disposition

- **Agy as primary implementation main:** supported by longitudinal throughput and successful
  source-grounded controls.
- **Agy as unsupervised safety-trusted main:** not established.
- **“More memory” as the primary repair:** refuted for this sample.
- **Immediate system investigation:** capture the real PreToolUse payload/host behavior, then choose
  one single-purpose Git gate; independently bind review to material claims.
- **Compaction strategy:** shorten real work sessions and re-ground first; do not build a runtime
  supervisor yet.
- **Model escalation:** reserve a stronger independent lane for unresolved source/product ambiguity,
  not as a duplicate reviewer after grounded Agy evidence already passes.

## Evidence limits

- Transcript order proves retained messages, checkpoints, injected context, tool calls, and outputs;
  it does not expose the exact serialized provider request for every step.
- No retained PreToolUse decision or UI permission receipt exists for `5800bb0`; host contribution
  remains unresolved.
- Primary-owner labels are analytical attribution, not experimental causality.
- No new provider run tested whether the proposed controls change behavior.
- The dirty external-product wallet tree may contain later corrections or unfinished work and is not a final
  quality sample.
- Final product and visual acceptance remains Mahiro-owned.
