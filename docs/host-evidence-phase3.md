# Host Evidence Phase 3: Direct CLI Callback Evidence Adapter

## Status

This document describes **current source after released v1.19.0**. Phase 3 is
not part of the v1.19.0 release history. On 2026-09-13, one bounded Agy 1.2.2 /
Gemini 3.8 Flash High canary completed through the installed Direct CLI v2
callback path: the exact target report was delivered, acknowledged by the
receipt-bound parent, collected, independently ingested, Phase 2-scored PASS,
and sealed with `verifiedLive: true`. Before/after repository and live MemFS
content snapshots were equal. The Phase 3 test lane itself remains deterministic
and launches no Herdr, Agy, provider, browser, or network action.

## Bounded Ownership Model

Phase 3 execution decouples runtime lifecycle execution from evidence verification:

| Owner | Location | Responsibilities |
| --- | --- | --- |
| **Direct CLI runtime/lifecycle owner** | `/Users/mahiro/.letta/skills/direct-cli` (`scripts/herdr-jobs.py`) | Owns Herdr shell readiness, trust prompt handling, prompt dispatch, wait/callback lifecycle, target result collection, and workspace cleanup. This repository must not implement a parallel Herdr transport. |
| **This repository** | `learn-letta-code` (`tools/host-evidence-direct-cli.ts`) | Pure receipt/replay/scoring/checkpoint verifier. It verifies already-terminal retained Direct CLI job bundles and callback messages, validates before/after repository and MemFS snapshots, translates evidence into Phase 2 immutable store receipts, derives scoring, and seals Phase 3 checkpoints. It never spawns Herdr or Agy, sends keys/prompts, waits, closes panes/tabs, or mutates Direct CLI state. |
| **Phase 2 immutable store** | `tools/host-evidence-store.ts`, `tools/host-evidence-receipts.ts` | Supporting owner providing immutable filesystem store, append-only receipt hashing, replay verification, run derivation, scoring, and sealing. |
| **Released v1.19.0** | `docs/releases/v1.19.0.md`, `CONTRACT.md` | Historical release baseline strictly preserved without rewriting history. |

## Contract & Bundle Verification

The single evidence-only adapter module is `tools/host-evidence-direct-cli.ts` (strictly under 800 lines). It verifies retained job directories against the exact Direct CLI v2 specifications:

### 1. Job Bundle Schema (`direct-cli.herdr-job.v2`)
- **Origin, Mode & Status**: Only the installed Direct CLI schema `direct-cli.herdr-job.v2` derives live mode. Deterministic test bundles use the separate `direct-cli.herdr-job.fixture.v1` schema and cannot be promoted by a caller flag. Both require `mode: 'callback'` and `status: 'done'`; watcher jobs, `watcherFallback: true`, and non-terminal or failure statuses (`attention`, `error`, `running`) are rejected.
- **Target Integrity**: Requires exactly one target with valid `name` (`^[a-z][a-z0-9_-]{0,31}$`), `agentKind` starting with `agy`, matching `agentName`, non-empty `paneId`, `workspaceId`, `tabId`, `terminal`, `herdrSocket`, and `agentSession`.
- **Working Directory**: Target and job `cwd` must resolve to the expected repository working directory.
- **Prompt Hash Binding**: `promptSha256`, `taskSha256`, `taskPromptSha256` must be equal and match the manifest prompt hash. `prompt.txt` and `dispatch-prompt.txt` must match declared hashes, contain no NUL bytes, and the dispatch bytes must begin with the exact task prompt plus Direct CLI's callback-contract boundary.
- **Filesystem Boundaries**: The job directory and all bundle files (`prompt.txt`, `dispatch-prompt.txt`, `job.json`, `message.json`, `body`, `results/*.txt`) must be regular files; symlinks are rejected.

### 2. Callback Message Schema (`direct-cli.callback-message.v1`)
- **Header Contract**: Schema `direct-cli.callback-message.v1`, `from: targetName`, `to: 'parent'`, `kind: 'report_ready'`.
- **Receipt Matches**: `senderReceipt` must match the job's target receipt across all identifiers (including `agentSession`). `ack.receipt` must match `parentReceipt`.
- **Parent Acknowledgement**: `delivery.status` must be `accepted`, and `ack` must exist with `ack.by === 'parent'` and non-empty receipt.
- **Body Integrity**: Message `body` must be UTF-8 text <= 8192 bytes with no NUL bytes, matching `bodySha256` and `bodyBytes`. The result file (`results/<target>.txt`) must have identical byte content.

### 3. Canary Report Contract (`DirectCliCanaryReport`)
The report body contained within the callback message must be a JSON object with:
- `schemaVersion: 1`
- `taskId` matching manifest `taskId`
- `promptHash` matching manifest `promptHash`
- `reportedHost`: target-reported `agyVersion`, `model`, `effort` matching planned host; this is receipt-scoped self-report, not provider attestation
- `invarianceClaims`: `repositoryMutated: false`, `memfsMutated: false`
- `providerAccounting`: `providerRequests: 'unavailable'`, `providerInputBytes: 'unavailable'`
- `finalResponse`: Valid `StrictFinalResponse` with `taskId`, `status: 'ANSWERED' | 'UNKNOWN'`, answer fields matching expected manifest fields, and valid singleton source citations.

### 4. Before/After Invariance
Snapshots of both the host repository and live MemFS (`headCommit`, `statusHash`, and a digest over every tracked/untracked non-ignored regular file's path, mode, and bytes) taken before and after the Direct CLI run must be byte-equivalent. This catches changed bytes even when an already-dirty path keeps the same porcelain status. Any modification during the run fails verification.

## Phase 2 Compatibility Projection & Sealing

After Direct CLI receipt verification succeeds, the adapter creates an authorized
Phase 2 run and emits a **compatibility-only projection** so the callback's frozen
prompt and final response can be evaluated by the existing Phase 2 scorer. The
projection is not a claim that the callback job itself created a new Agy session
or exposed Direct CLI's internal foreground-process observations:
1. `attempt.reserved` (processId from target terminal)
2. `shell.ready` (processId, cwd from expectedCwd)
3. `host.observed` (from plannedHost)
4. `effect.reserved` & `effect.submitted` for conversation creation
5. `conversation.created` (conversationId from target `agentSession`)
6. `effect.reserved` & `effect.submitted` for user input
7. `user-input.observed` (structured: true, taskId, promptHash)
8. `planner.response` (kind: 'final', response from canary report)
9. `observations.closed`

The run is sealed using `sealRun(handle)`, and Phase 3 rejects the result unless the independently derived Phase 2 score passes. The adapter then constructs a canonical hash-bound (not cryptographically signed) `Phase3DirectCliCheckpoint` binding:
- `directCliJobHash`
- `reportHash`
- `targetReceipt` & `parentReceipt`
- `beforeRepositorySnapshotHash` & `afterRepositorySnapshotHash`
- `beforeMemfsSnapshotHash` & `afterMemfsSnapshotHash`
- `phase2ReceiptCount`, `phase2ReceiptHead`, `phase2Checkpoint`
- `phase2Projection: 'compatibility-only'`
- Canonical `checkpointHash`

## Verification & Test Suite

The Phase 3 test suite consists of **30 focused unit and counterexample tests** in [`tests/host-evidence-direct-cli.test.ts`](../tests/host-evidence-direct-cli.test.ts):
- Positive live and fixture bundle acceptance
- Watcher rejection, watcherFallback rejection, non-done status rejections
- Missing/corrupt agentSession, paneId, workspaceId, terminal rejections
- Missing parent acknowledgement, non-accepted delivery status
- Prompt, dispatch-prompt, and message body hash tamper rejections
- Result file / message body divergence
- Duplicate job identity, symlink directory / file rejections
- Repository and MemFS status or same-status content mutation rejections
- Working directory mismatch rejections
- Canary report schema, host claims drift, mutation claims, and score-failing final-response rejections
- Checkpoint tampering detection

Total host-evidence tests across the repository: **108 tests** (27 contract + 33 lifecycle + 18 store + 30 direct-cli).

Final current-source verification on 2026-09-13 passed **188/188 Node tests**,
**11/11 isolated integration scenarios**, `pnpm check`, plugin validation, and
`git diff --check`. Aggregate coverage passed at **86.32% lines**, **73.63%
branches**, and **90.00% functions**. These figures describe the development
candidate, not released v1.19.0.

## Non-claims

Current source does not claim:
- that this repository implements Herdr transport, shell interaction, trust prompts, or cleanup (owned exclusively by Direct CLI);
- that Phase 2 compatibility events are native Direct CLI shell/conversation/provider receipts;
- provider request counts or provider-visible input bytes;
- authenticated operator identity or trusted timestamps without external anchor;
- protection against an actor that can coherently rewrite every same-UID local artifact and recompute unkeyed hashes;
- inclusion in released v1.19.0 or universal host behavior.
