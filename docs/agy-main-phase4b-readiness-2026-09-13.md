# Agy Main Phase 4B: v1.20.0 Local Readiness Candidate

**Date:** 2026-09-13

**Latest published release:** `v1.19.0`

**Current development candidate:** `v1.20.0` (unreleased)

**Verdict:** Ready only as an interactive, human-supervised release candidate; not established as an unsupervised safety-trusted main.

## Scope and ownership

This is the canonical current-candidate readiness report. The dated Phase 4A external-product attribution baseline remains historical input rather than a current implementation owner. The retained canary packet under `docs/evidence/agy-main-phase4b-canary-2026-09-13/` is bounded reproducible evidence; raw diagnostics remain outside Git.

The candidate changes two narrow control surfaces:

1. atomic confirmation-request classification for selected tool shapes; and
2. deterministic validation of material-claim review packet structure, current file bindings, reviewer metadata, counterexample outcomes, and evidence coverage.

Neither surface is an authorization authority or a semantic-proof system.

## Candidate verification

The completed candidate checks recorded before this documentation pass were:

- full `pnpm test`: **206/206 Node tests passed**;
- generated integration suite: **11/11 scenarios passed**;
- `pnpm test:coverage`: **206/206 passed**;
- aggregate V8 coverage: **86.71% lines, 74.97% branches, 90.66% functions**;
- `pnpm check`: passed;
- `git diff --check`: passed; and
- plugin validation inside integration: **14 skills, 9 agents, 3 hooks, zero errors**.

These are local `v1.20.0` candidate results. They do not alter the published `v1.19.0` release evidence or make `v1.20.0` released.

## Atomic confirmation-request gate

The PreToolUse guard is an atomic confirmation-request classifier. For the shapes it recognizes, it:

- denies destructive, protected-target, malformed, unknown-risk, or ambiguous bundled shapes;
- requests fresh host confirmation with `force_ask` for one scoped mutation;
- includes the normalized Git action and resolved repository scope in the Git mutation reason; and
- does not trust conversation, transcript, or model metadata as a grant.

The guard does **not** authenticate authorization, issue grants, verify who approved a prompt, bind an authenticated action hash or approval receipt, or universally cover shell semantics. A host prompt is still a confirmation request, and host/user interaction remains outside the plugin's authority.

## Material-claim review packets

A material-claim subject packet names each consequential claim, its canonical owner, one or more consumers, the failure condition, and required evidence kinds. File references bind current owner/consumer bytes by SHA-256 plus required contained text. A separate review packet binds the subject hash and requires:

- a different reviewer conversation ID with role `fresh-read-only`;
- a reviewer start timestamp no earlier than writer completion;
- direct evidence for every owner and consumer binding;
- an explicit counterexample probe and outcome; and
- coherent `pass`, `fail`, or `blocked` result tuples.

Verification re-reads current contained regular-file bytes and rejects stale, tampered, missing, substituted, symlinked, or out-of-repository bindings. Overall `fail` outranks `blocked`, which outranks `pass`.

This verifier checks packet shape, exact current file bytes, declared evidence coverage, and internally coherent outcomes. It does not prove that the evidence is semantically correct, that a reviewer truly observed a runtime or UI, or that the reviewer identity is authenticated. Its identity boundary is always `not-authenticated`.

## Isolated real canary

One isolated canary used Agy `1.2.2`, Gemini 3.8 Flash High, high effort, the Herdr backend, no YOLO, and exactly one provider task submission.

The observed PreToolUse payload contained `artifactDirectoryPath`, `conversationId`, `modelName`, `stepIdx`, `toolCall`, `transcriptPath`, and `workspacePaths`. The exact command `git commit --dry-run` caused a visible fresh `force_ask` reason naming that command and the disposable repository. The payload and plugin output still contained no authenticated grant, action hash, or approval receipt.

The fresh Agy review packet found the seeded release-state contradiction and returned `fail`. It marked the host-prompt claim `blocked` because the reviewer model did not itself observe the permission UI. The strict verifier accepted the packet shape and current bound bytes, returned overall `fail` with expected exit code `1`, and reported `identityAuthentication: not-authenticated`. This was an honest negative-control result, not a semantic proof.

The canary's tracked and cached Git diffs remained empty, its HEAD stayed unchanged, and its tool ledger contained reads/search/list operations plus exactly one `git commit --dry-run`, with no writes. Live MemFS and the protected external product snapshot remained exact. Main concurrently edited in-scope source metadata and tests, so target source diff bytes changed during the canary even though source HEAD and the status path set remained unchanged. Whole-interval source invariance is therefore not claimed.

A later independent source review found three bounded guard gaps: tool-level `Cwd` was not used for
repository scope, compact output redirections were missed, and unmatched shell quotes were accepted.
The final source now resolves and contains `Cwd`, detects compact and ordinary output redirections,
denies malformed quoting, and has direct regressions for those counterexamples. Because the single
host canary had already been consumed, it was not resubmitted. Instead, the exact captured
PreToolUse payload was replayed offline through the final guard bytes and produced the same
`force_ask` action and repository scope. This binds the observed canary shape to the final
classifier for that exact payload; it is not a second real-host canary or universal shell proof.

## Model-guided continuity boundary

Bounded re-grounding and fresh-conversation rotation are model-guided operating policy only. After compaction or contradictory summaries, the model should re-read current owners and task criteria, treat summaries as navigation rather than authority, and rotate to a fresh conversation at a coherent checkpoint.

There is no compaction interceptor, durable mission supervisor, deterministic conversation rotation, automatic continuation, or final-response blocker in this candidate. The failed execution-continuity candidates remain historical evidence and were not promoted into runtime behavior.

## Deferred host boundaries

Two canary observations prevent an unsupervised-readiness claim:

1. Herdr `agent prompt/wait` reported `done` while the pane was still awaiting permission. Main pane inspection exposed and resolved the exact prompt. Interactive pane supervision remains required.
2. The reviewer model could not observe the permission UI. Main's separate pane observation cannot be laundered into reviewer-observed evidence, so that material claim correctly remained `blocked`.

The candidate therefore cannot be described as a lifecycle supervisor, permission authority, or unattended execution safety boundary.

## Readiness disposition

The strongest honest boundary is an **interactive, human-supervised `v1.20.0` release candidate**. Within that boundary, current automated tests, plugin validation, atomic confirmation-request behavior, material-claim packet validation, and one bounded negative-control canary support local readiness review.

Promotion beyond that boundary requires at minimum host lifecycle behavior that does not report stale completion while permission is pending, an evidence route that lets the responsible reviewer observe the relevant UI/runtime claim, and explicit human release approval. Until then, the latest published release remains `v1.19.0`.
