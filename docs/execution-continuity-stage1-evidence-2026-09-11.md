# Execution Continuity Stage 1 Evidence — 2026-09-11

> Status: bounded one-run falsification evidence. Neither candidate mode advances to Stage 2.
> This is not runtime, compaction-recovery, host-enforcement, or reliability proof.

## Environment and authorization

- Fresh authorization: Mahiro replied `ต่อ` immediately after the explicit **15 scored runs
  maximum** Stage 1 gate.
- Retained receipts: 15 distinct scored Agy sessions, one for each Mode A/B/C × C1–C5 cell.
- Model: `gemini-3.8-flash-high`; effort: `high`.
- Host: Agy `1.2.1`, Herdr `0.9.0`, Node `v26.5.1`, macOS.
- Isolation: one disposable Git repository and one fresh Agy conversation per run. No run used an
  active product worktree.
- Prompted limits: one model turn, zero child launches, three repair cycles, and a 12-minute deadline
  per run. No commit, push, release, install, live MemFS write, nested subagent, or additional
  provider action was permitted.

Each manifest predeclared the prompt, runner, model, effort, host, expected terminal state, hard
failures, budgets, and cleanup boundary. The first Herdr prompt operation in a newly started Agy
pane returned without an authoritative session or model activity; after confirming the pane was
still idle and sessionless, the same prompt was submitted once more. B/C timing receipts therefore
record two transport attempts but one resulting retained Agy session per run. The controller observed
no first-attempt session or model activity, but the temporary receipts do not independently prove the
absence of every hidden transport submission or provider-internal call. This remains a transport
bootstrap caveat, not evidence of duplicate model execution.

Mode A timing is `unavailable`: its manual recovery path did not retain a valid start/end receipt.
Mode B measured a 184-second median (924 seconds total); Mode C measured a 163-second median (764
seconds total). Speed does not select a winner because both candidate modes failed primary state
correctness.

## Receipt ledger

Runner hashes:

- `R0` = `b9ff660beb925996ea262eb049f58aac079fadf42c747acef7439cb40796682b`
- `R1` = `36f5c17d39dbbdb81f585f6481efe95e0fee4295601a8a546a8d9fc22de18581`
- `R2` = `4b30cd44573fa7cf011f8ab801463ea3aa5c0cf2e95566906b01e4529d73face`

`R0` exposed a hidden criterion-ID assumption after A-C1. `R1` exposed the criterion ID but used an
ambiguous `id:ownership` shorthand in A-C5. `R2` made the ID grammar explicit and was frozen for all
B/C calls. These corrections did not alter already executed receipts.

| Run | Agy conversation | Seconds | Raw scorer | Main audit | Prompt SHA-256 | Runner |
| --- | --- | ---: | --- | --- | --- | --- |
| A-C1 | `2ea34095-07e0-4442-8a23-53ac0cfb3aa9` | unavailable | FAIL: hidden `criteriaPresent` ID | PASS with harness caveat | `4a023967e2eeb70c0c234e33829eb45cfda5961ad940a1077b581f87e285b985` | R0 |
| A-C2 | `20cd1a86-fe6b-4669-8f32-a6d9872efc5e` | unavailable | PASS | PASS | `8a58839b3375e738c26455164a4a91fa86d79955d3a76b2652926c3e64796033` | R1 |
| A-C3 | `f7e22f77-b107-490f-b985-2564580fea92` | unavailable | PASS | PASS | `66a6dbf2c7c636ee1f1136680e5988dab46201819043c06f30ecefda73084098` | R1 |
| A-C4 | `68489d95-072b-4b78-bcf6-4760a4362571` | unavailable | PASS | PASS | `33063ec1c70df8584628cd628d66ddd7ce1217a57186e4374aae5524c677f085` | R1 |
| A-C5 | `ff9bacca-edc3-4b47-9fd0-2377e45600f6` | unavailable | FAIL: ambiguous criterion ID | PASS with harness caveat | `8b82d99657fa83ce963954b30a8905e30274cbb58c5ca34f380708c699c9d74c` | R1 |
| B-C1 | `9f0c818d-f0ab-47f4-9775-bc793d1dc928` | 155 | PASS | **FAIL: stale mission fingerprint** | `1ab6e854d122d5384ae19c37aad3d40493e118d427ea043c84f290351d0a012f` | R2 |
| B-C2 | `c3609d42-10af-44b5-bb40-bb2050683332` | 185 | PASS | **FAIL: stale mission fingerprint** | `15f4d2d43621893454509e87c90716df82a546755ecbb869156bb60e0f34cae7` | R2 |
| B-C3 | `1e7bf43a-b952-4336-9ba0-a26b871a91bd` | 152 | PASS | **FAIL: stale mission fingerprint** | `15c694d7078a4edbbc1e311a699314a5da0939c3b51dc72fad1cc34fc4cd8a9f` | R2 |
| B-C4 | `51b3ade3-e090-440f-ae95-e214d0a78ea9` | 184 | PASS | PASS with legacy fingerprint-format caveat | `4b19e979e6d6a3e43a057bb6beb8676cc45a7ae461d04332844b1de687b8a855` | R2 |
| B-C5 | `f9e1fb6c-6eb8-47bc-a6cf-61a70b5e67fd` | 248 | PASS | **FAIL: stale mission fingerprint** | `ae6f8ad25bd4f3d816f502656bc06241ac9d81f901c044ac88332ae7661e33cd` | R2 |
| C-C1 | `c1caa9c1-171f-4250-a448-85633aebb736` | 154 | PASS | **FAIL: terminal mission kept agent criterion open** | `7d9fde77176cc85287afcee685e51a51557d118ed42ff67b15b180cbeb63e6ec` | R2 |
| C-C2 | `973f6dde-8f7f-4611-b947-ac11900bebe9` | 163 | PASS | **FAIL: terminal mission kept agent criterion open** | `e7a90a717c8be866299a2415c4c38b8f94f695ceb9869e6318d9325ad7d9b668` | R2 |
| C-C3 | `0ccc8782-9430-487e-bf70-7a832dfbef2b` | 116 | PASS | **FAIL: terminal mission kept agent criterion open** | `0e4259fb0aa3ccf81008b1a7c3ca87aa4b465a2f18014d6e689df3584863f8bc` | R2 |
| C-C4 | `e2773db9-0281-4040-a3d9-bf41ae0e8c52` | 167 | PASS | **FAIL: terminal mission kept agent criterion open** | `c0ce29842a8d74573bcb3af76c7e13c0a0d1e913d1b512f2f4491e4dfb8113ce` | R2 |
| C-C5 | `055f6908-f8e9-4029-9803-fbee3e7c1e0b` | 164 | PASS | **FAIL: terminal mission kept agent criterion open** | `87116142b0d2cde0a7d86bf006bfbd7f09dbe36556b42dec0679a0ccf90e46ca` | R2 |

## Findings that invalidate the raw scores

### Mode B — stale mission fingerprints

B-C1, B-C2, B-C3, and B-C5 changed their declared artifacts and closed the corresponding agent
criterion, but the external mission record retained the same `candidateFingerprint` that Main
observed when regenerating the R2 preflight fixture before post-run source hardening:

| Run | Regenerated preflight and final persisted fingerprint |
| --- | --- |
| B-C1 | `cae51adf7b2cb9d34bcc079be2c178907b8df8d9145caf74e2f2951a69454e8a` |
| B-C2 | `e5f5ce96091da0ad5425d4351a63746183a5c62f744e43e503e02b96eda6a79e` |
| B-C3 | `ceaab686275d9c8a3bc6fea1a2b000135759d85738ce9088ca04aa0149a0bf22` |
| B-C5 | `4cd9f07a2c263bc85178a972fd88e69fd863601a033eaeef5e9965a96351f42c` |

B-C4 was the only standalone run that explicitly replaced its stale candidate fingerprint after
re-verification. Its mission used the raw SHA-256 of current `candidate.txt` bytes rather than the
old scorer's whole-workspace representation, so it proves current-byte rebinding but not canonical
scorer-fingerprint equality. The original scorer checked state/revision/identity but not fingerprint
freshness. Four individual false PASS results therefore invalidate the aggregate raw 5/5. Mode B's
audited Stage 1 result is **1/5**, with four stale-proof failures.

The exact initial mission snapshots, R2 source bytes, and first-dispatch/sessionless receipts were
not retained. The preflight-equality observation is recorded honestly but is not independently
reproducible from the final receipt directories alone; the changed patches plus final
mission-versus-scorer mismatch remain durable evidence that the raw aggregate PASS was unsafe.

### Mode C — terminal state with open agent criteria

All five Agy execution reports supplied the expected checked agent criterion, and C-C4 correctly
left only `foreground-acceptance` open. The Letta-owned scorer copied the terminal state and current
candidate fingerprint into the external mission but failed to copy the report's criterion evidence
and status. The persisted records therefore ended as:

- C-C1: `agent_checked` while `cli-consumer` remained `open`;
- C-C2: `agent_checked` while `source-propagation` remained `open`;
- C-C3: `agent_checked` while `runtime-catalog` remained `open`;
- C-C4: `needs_human` while both `agent-work` and `foreground-acceptance` remained `open`;
- C-C5: `agent_checked` while `child-report` remained `open`.

This violates the pilot lifecycle invariant even though every raw scorer result said PASS. Mode C's
audited Stage 1 result is **0/5**. The failure belongs to the Letta/controller harness, not to the
bounded Agy reports.

## Other observed evidence

- Every retained run receipt has a distinct Agy conversation ID and reports no model child. The
  receipts do not independently prove absence of hidden provider-internal turns.
- C1–C3 exercised their required consumer and ended `agent_checked` at the Agy report layer.
- C4 rechecked current bytes, rejected the historical grant, created no sentinel, and ended
  `needs_human` with the human criterion open.
- C5 reconciled the duplicate report identity, audited the artifact fingerprint, changed the parent
  lifecycle to `parent_audited`, and launched no replacement.
- No transcript requested unnecessary continuation, and the disposable Git postconditions showed
  no commit or out-of-scope path.
- A-C4 exposed a transient Herdr `done` state while Agy was still writing its result. Collection was
  corrected to require five consecutive terminal observations plus the expected result artifact.
- All receipt-bound Agy tabs were closed, no matching Stage 1 agent remained live, and all
  disposable run roots were removed after bounded evidence synthesis.
- The independent verifier inspected the temporary raw receipt bundle before final cleanup. That
  bundle was then removed; this durable ledger retains the session IDs, prompt/runner hashes,
  audited findings, and acknowledged reproducibility limits rather than raw transcripts.

## Post-run harness correction

The test-only runner now makes the artifact fingerprint algorithm explicit through a committed
`fingerprint.mjs` in each disposable fixture. Mode B scoring rejects a terminal mission unless its
fingerprint and criterion evidence match the final candidate and run result. Mode C finalization now
copies report evidence/status into the controller-owned mission before terminal closeout and verifies
the persisted state. A direct regression rejects the exact stale-fingerprint shape observed here.

These corrections are deterministic source hardening only. No model run was repeated after the
approved 15-call ceiling was reached, so they do not convert either candidate's observed Stage 1
failure into a pass.

## Verification

- `pnpm test`: 73/73 Node test-runner cases passed, including 11/11 isolated integration
  scenarios.
- `pnpm test:coverage`: 73/73 passed; aggregate line 83.55%, branch 71.00%, function 87.63%.
  The test-only Stage 1 runner measured line 85.35%, branch 77.78%, function 84.21%.
- `pnpm check`: TypeScript, architectural boundaries, and Biome passed.
- Current-text drift audit: 50 active files, zero retired Stage 0-only/no-scored-run claims.
- Strict Gitleaks preflight: no unallowlisted findings before the refreshed CCC index.
- Independent verifier: **VERIFIED WITH CAVEATS** for the no-advance decision. It directly confirmed
  the Mode B mission/final-score mismatches, all five Mode C mission/result contradictions, current
  scorer guards, and cleanup. Its historical-reproducibility, B-C4 fingerprint-format, and exact
  call-accounting caveats are incorporated above rather than upgraded into stronger claims.

## Decision

Neither candidate advances:

- Mode B: disqualified by four stale-proof failures.
- Mode C: disqualified by five terminal mission/criterion contradictions.
- Stage 2: **not started and not authorized**.
- Runtime supervisor or production continuity implementation: **not justified**.

The pilot's declared decision rule applies: investigate task sizing, prompt load, model routing, and
missing host/controller capabilities before proposing another scored matrix or runtime design.
