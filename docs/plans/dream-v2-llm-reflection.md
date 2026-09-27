# Dream v2: LLM-Backed Reflection — Living Execution Plan

> **Status:** Active implementation mission
>
> **Goal:** `mh-goal-muiis4g0-d9899d97`
>
> **Started:** 2026-09-26
>
> **Current phase:** Complete with manual-only acceptance. The first authorized provider
> proof failed closed on newly observed Agy 1.2.12 `structured_output` and
> `json_schema` fields. A separately authorized diagnostic captured the exact
> shape. After the strict raw-envelope correction and independent verification,
> the final bounded one-call proof passed through explicit proposal creation and
> disposable cursor advancement. Mahiro accepted explicit manual `--run-now
> --llm` behavior only; automatic reflection and persistent scheduling remain
> disabled and were not approved.
>
> **Default behavior:** Deterministic regex Dream remains enabled. `reflection.enabled` gates automatic or scheduled LLM only and defaults to false. Manual `--run-now --llm` is the operator override. No LLM schedule is installed.

## Objective

Implement Dream v2 across Phases 1–4 without weakening Agy's existing memory
contracts. The model may propose a bounded change, but it never owns a file,
approval, Git commit, cursor, lock, schedule, or completion claim.

The finished system must recognize implicit durable corrections that the current
regex path misses, preserve exact transcript facts, create reviewable proposals,
and remain safe when the model, schema, repository, cursor, or host changes.

## Current Reality

### Existing owners

- `dream-daemon.ts` owns deterministic transcript scanning, project routing,
  regex extraction, archive-only notes, `lastDreamedSteps`, cross-project runs,
  and the current cron utility.
- `memory-approval.ts` owns path-normalized memory proposals and human review.
  Its normal policy permits auto-commit for some learning/archive paths, so
  Dream v2 must add an explicit-proposal override rather than trusting the
  destination's default policy.
- `memory-repository.ts` owns committed reads, path containment, clean-repo
  checks, targeted writes/commits, and rollback.
- `memory-write-lock.ts` owns the short critical section for real MemFS writes.
  Dream v2 must not hold this lock during a model call.
- External cursor state lives under `AGY_MEMORY_STATE_DIR` (or the sibling
  `memory.state` directory). It is not active prompt memory and is not committed
  into MemFS. Phase 4 adds `reflection-reservation.json` and a hash-only
  `reflection-receipt.json` in that same external root.
- `docs/agy-main-phase4a-external-product-attribution-2026-09-13.md` and
  `docs/agy-main-phase4b-readiness-2026-09-13.md` are historical Agy Main
  release evidence. They are not owners of this Dream v2 phase.

### Live Agy capability evidence (2026-09-27)

- Agy CLI version: `1.2.12`.
- `agy --print` supports a noninteractive turn, `--output-format json`,
  `--json-schema`, `--model`, `--effort`, `--agent`, `--mode`, `--sandbox`,
  and `--print-timeout`.
- The exact listed primary model is `claude-opus-4-6-thinking`.
- `gemini-4.8-high` is **not** in the current catalog. Gemini 3.x must not be
  substituted silently.
- Declarative native-agent capability flags and model tiers express intent; the
  current evidence does not prove their host enforcement or exact resolved
  model identity.
- No advertised TypeScript SDK or CLI flag guarantees a tool-less model call.
  Therefore the pure reflector core will expose no tools, while the optional
  Agy process adapter remains a separately evidenced host boundary. Prompting a
  model not to use tools is not accepted as isolation proof.
- A no-quota `agy --output-format json --print '/model'` probe on the current
  host returns the machine envelope owned by Agy 1.2.12:
  `conversation_id`, `status`, `response`, `duration_seconds`, `num_turns`,
  `usage`, and `command`. The live adapter uses that read-only command to reject
  requested-model drift before a provider turn, then accepts only a bounded
  successful agent-turn envelope without a command payload. This proves the
  current invocation shape, not host-enforced tool isolation.

## Resolved Product Decisions

1. **Provider boundary:** use an injected `ReflectionTransport` interface.
   Tests use a fake transport. The only live adapter may spawn `agy --print`
   with an exact currently listed model, JSON schema, timeout, bounded output,
   disabled slash expansion, plan mode, and sandbox mode.
2. **Primary model:** `claude-opus-4-6-thinking`, selected explicitly after a
   fresh catalog check. A configured model absent from that catalog fails
   closed before a provider turn.
3. **Fallback model:** `null` until `gemini-4.8-high` appears in a fresh catalog
   and earns its own bounded receipt. Primary failure triggers backoff and
   deterministic archive behavior—not an invented Gemini 3.x substitution.
4. **Call granularity:** one conversation per model call. This keeps attribution,
   cursor advancement, backoff, proposal IDs, and retries independently auditable.
5. **Cost gate:** automatic and manual LLM eligibility both begin after 50 new
   transcript steps. `--llm --force` bypasses only the next-eligibility backoff
   clock. It does not lower that step gate or skip schema, path, repository,
   snapshot, approval, or lock guards. Deterministic regex Dream retains its
   existing 20-step trigger.
6. **Language:** the reflector prompt is English for consistency but explicitly
   treats Thai and English as first-class evidence and preserves exact commands,
   identifiers, paths, ports, and quoted wording in the source language.
7. **Mutation model:** all LLM writes become pending explicit proposals. No LLM
   operation auto-commits, even when the destination's normal policy is `auto`.
   Every operation is validated before proposal creation; a multi-write run
   either creates its complete proposal set or removes the partial set and
   leaves the reflection cursor unchanged.
8. **Delete semantics:** delete suggestions are parsed and reported as
   `CURATION_REQUIRED`; Dream v2 never deletes active memory. Removal or
   paraphrase must use provenance-preserving `memory-curation.ts` separately.
9. **Scheduling:** source may expose an explicit LLM cron command and activation
   guard, but no persistent schedule is installed or enabled before Mahiro's
   human activation gate.

## Protected Contracts

- Deterministic regex extraction remains the default and keeps archive-only
  output.
- LLM mode is explicit, disabled by default, and fail-closed.
- The model never receives filesystem, Git, approval, cursor, lock, or schedule
  ownership through the reflector API.
- Memory is read from committed HEAD. A changed MemFS HEAD between snapshot and
  proposal creation rejects the reflection.
- Existing path containment, clean-repository checks, proposal hashes, approval
  review, targeted commits, and rollback remain authoritative.
- Tests and fake transports use disposable HOME/MemFS roots. Live user memory is
  never a test fixture.
- A successful JSON response does not prove exact provider routing, no tool use,
  or host isolation. Those are separate runtime receipts.

## Target Architecture

```text
transcript scanner + per-conversation cursor
                  │
                  ▼
         committed memory snapshot
                  │
                  ▼
        dream-reflector.ts (pure core)
        prompt + strict schema + guards
                  │
                  ▼
      injected ReflectionTransport boundary
       fake in tests / bounded Agy adapter
                  │
                  ▼
          validated operation planner
      write → explicit memory proposal only
      delete → CURATION_REQUIRED report only
                  │
                  ▼
       state receipt + cursor + backoff update
```

Raw prompts, transcript slices, and model responses are processed in a
session-owned temporary directory and removed after validation. Durable external
state retains only bounded metadata, hashes, outcome, requested model, CLI
version, proposal IDs, and cursor positions.

## State Schema

`dream-state.json` remains backward compatible. Missing reflection fields
normalize to the disabled defaults below:

```json
{
  "stateRevision": 0,
  "lastRun": null,
  "stepCountThreshold": 20,
  "lastDreamedSteps": {},
  "lastRunByProject": {},
  "reflection": {
    "enabled": false,
    "model": "claude-opus-4-6-thinking",
    "fallbackModel": null,
    "maxOperations": 8,
    "memoryCharacterBudget": 40000,
    "transcriptCharacterBudget": 60000,
    "stepCountThreshold": 50,
    "baseBackoffMinutes": 15,
    "maxBackoffMinutes": 360,
    "reflectedThroughStep": {},
    "failures": {},
    "lastRunByConversation": {}
  }
}
```

Legacy files without `stateRevision` read as revision 0. Each successful
whole-state write increments it under the shared writer lock; a stale caller is
rejected and must reload rather than overwrite a newer cursor or configuration.
A present but invalid revision fails closed for both regex and LLM writers; it
is not eligible for generic corrupt-file recovery.

`reflectedThroughStep` advances only after a valid bounded response has been
fully classified and every supported write proposal has been created. It does
not advance on transport, timeout, schema, model-catalog, snapshot-race, or
proposal failures. A valid no-operation result advances the cursor because that
slice was reviewed. Human rejection does not re-run the same slice endlessly;
deterministic archive evidence remains available.

## Phase 1 — Pure Reflector Core

**Primary files**

- New `plugins/agy-memory-layer/scripts/dream-reflector.ts`
- New pure `plugins/agy-memory-layer/scripts/memory-paths.ts`, re-exported by
  `memory-repository.ts` to preserve existing callers without importing its
  filesystem/Git process graph into the reflector
- New `tests/dream-reflector.test.ts`
- Test script registration in `package.json`

**Implementation**

- Define strict reflection result and operation types.
- Build a bounded prompt from a committed memory snapshot and one unreflected
  transcript slice.
- Preserve complete Unicode code points while bounding memory to 40,000
  characters and transcript evidence to 60,000 characters.
- Require exact JSON with no unknown fields and at most eight operations.
- Bound the complete response and every summary, path, description, and body
  field before planning operations.
- Accept `write` and `delete` operation shapes; classify delete as requiring
  curation before any mutation path.
- Normalize and contain paths; block archives, references, hidden state,
  non-Markdown targets, non-active owners, cross-project targets, and targets
  absent from the supplied snapshot.
- Implement anti-loss validation. A write must retain at least half of existing
  nonblank lines; the downstream approval owner retains its stricter durable-unit
  preservation check.
- Prompt rules prohibit invented commands, paths, ports, facts, permissions,
  approvals, and capabilities; uncertainty produces no operation rather than a
  guessed repair.

**Exit checks**

- Focused tests cover valid bilingual evidence, malformed JSON, unknown keys,
  duplicate paths, operation overflow, unsafe paths, wrong-project paths,
  oversized inputs, Unicode boundaries, delete classification, and anti-loss.
- Typecheck and layer-boundary checks pass.

## Phase 2 — Opt-In Dream Integration

**Primary files**

- `plugins/agy-memory-layer/scripts/dream-daemon.ts`
- New `plugins/agy-memory-layer/scripts/dream-reflection-transport.ts`
- `plugins/agy-memory-layer/scripts/memory-approval.ts`
- Focused Dream integration tests

**Implementation**

- Add `--llm` without changing regex-default behavior.
- Initialize and own `reflection.reflectedThroughStep` in this phase. The cursor
  is distinct from regex `lastDreamedSteps` and archive UUID discovery.
- Select one conversation slice from `reflectedThroughStep + 1` through the
  current transcript length; do not use regex archive existence as an LLM cursor.
- Require committed project memory for current-project and cross-project LLM
  runs; do not inherit the deterministic current-project initialization gap.
- Snapshot committed active memory and exact MemFS HEAD before transport.
- Add an injectable fake transport and a bounded Agy process adapter.
- Before a live call, verify `agy --version`, refresh `agy models`, require the
  exact configured model ID, and refuse an unavailable fallback.
- Parse and validate the final structured result; reject nonzero exit, timeout,
  output overflow, malformed envelope, schema drift, or requested-model drift.
- Recheck MemFS HEAD after the model response.
- Add `requireExplicit: true` to the approval boundary so every supported Dream
  write creates a pending proposal regardless of path policy.
- Prevalidate the complete operation set and create proposal files through a
  set-level all-or-cleanup boundary so a later operation cannot leave an
  untracked partial reflection decision.
- Record delete suggestions as `CURATION_REQUIRED`; do not delete or synthesize
  a replacement curation plan automatically.
- On model failure, leave the LLM cursor unchanged and return a bounded failure
  result. Phase 3 owns persisted failure counters and backoff; deterministic
  regex Dream remains the only default write path.

**Exit checks**

- Focused tests prove default regex parity, explicit LLM dispatch, fresh-catalog
  refusal, timeout/schema/snapshot-race failure, forced explicit proposals, no
  MemFS commit before approval, and unchanged cursor after every failed class.

## Phase 3 — Configuration, Backoff, Status, and Approval Proof

**Primary files**

- `dream-daemon.ts` state normalization and status output
- Dream skill and operator docs
- Integration tests using disposable MemFS and fake transport

**Implementation**

- Persist disabled reflection configuration with backward-compatible defaults.
- Apply exponential backoff per conversation only after that conversation is
  selected: 15, 30, 60, 120, 240, then 360 minutes maximum. Each later failed
  class increments it. A successful no-op or created proposal resets it.
  `--force` bypasses only next-eligibility time, not the 50-step gate, schema,
  path, repository, snapshot, approval, or lock guards.
- `reflection.enabled` gates automatic or scheduled LLM only. Explicit
  `--run-now --llm` is a manual operator override. Status must label the flag
  as automatic/scheduled state. No schedule is installed in this phase.
- Extend status output with that automatic/scheduled state, exact requested
  model, eligible conversation count, pending proposal count, cursor lag, and
  backoff.
- Do not claim an in-repo Agy statusline owner: none exists in current source.
  Statusline integration is deferred unless a real owner is introduced later.
- Document `--llm`, provider boundaries, non-claims, failure behavior, approval
  commands, schedule preview, and recovery.
- Prove fake response → explicit pending proposal → human-style approval call →
  targeted disposable MemFS commit. Also prove rejection creates no memory
  commit and does not reactivate the same reviewed slice automatically.

**Exit checks**

- Integration tests cover success, no-op, reject, pending proposal, stale HEAD,
  backoff progression/reset/cap, old-state migration, and status reporting.
- Current deterministic Dream tests remain green.

## Phase 4 — Run Reservation, Isolated Boundary, and Activation Surface

**Primary files**

- Dream reflection state/reservation helpers
- CLI/schedule activation contract
- Runtime evidence documentation

**Implementation**

- Harden cursor advancement against appended transcripts and concurrent replay,
  building on the cursor introduced in Phase 2.
- Add one-active-reflection reservation under the external state root using
  owner token, PID, timestamp, conversation ID, and exact release semantics.
- Never auto-delete an ambiguous or live reservation. Provide an explicit stale
  inspection/reclaim path after process-liveness evidence.
- Build each provider attempt in a private system-temp run directory. Persist no
  raw transcript or prompt after completion; retain hashes and bounded receipts.
- Prevent recursion by marking reflection child processes and refusing a nested
  Dream v2 provider invocation.
- Add a deterministic cron command preview and an explicit guarded installation
  form for LLM mode. Source support may ship, but Mahiro selected manual-only
  operation, so no live crontab mutation is approved.
- Run one bounded live Agy print proof only after source/fake verification. The
  proof records CLI version, requested exact model, response schema outcome,
  timeout, exit status, repository/MemFS hashes, and any observed tool events.
  If no-tool execution cannot be proved, label host isolation unverified rather
  than upgrading the claim. The final gate ran this proof once after correction
  and retained the unverified host-isolation nonclaim.
- A crash after proposal creation and before cursor advance is not replayed.
  The leftover reservation stays dead or ambiguous until explicit inspect and
  token-matched reclaim. Reclaim does not delete proposals or advance a cursor.
- Correction after the Phase 4 candidate was refuted: cursor advancement and
  failure persistence take the shared writer lock only for the short reread,
  same-conversation check, and owned-field patch. The lock is not held across
  the provider call. Proposal creation, ownership, HEAD, prefix, and cursor
  revalidation run in one post-provider finalization transaction. Lock
  contention is infrastructure failure, not model backoff, and does not call
  the provider again. If that finalization cannot finish, the reservation stays
  for inspect or recovery. Reservation acquire, token-plus-owning-PID release,
  and token-plus-proven-dead reclaim use that same lock. Unexpected liveness
  errors stay ambiguous. Every whole-state save also carries a monotonically
  increasing `stateRevision`; a caller that read before another finalized write
  must reload instead of serializing its stale snapshot. If the final receipt
  cannot be persisted after cursor/proposal finalization, those two owners stay
  consistent, the result reports `ADVANCED_RECEIPT_FAILED`, and the reservation
  remains for recovery. A failed reservation release is likewise reported as
  `RESERVATION_RELEASE_FAILED` instead of being silently ignored. Both partial
  infrastructure outcomes keep their truthful `advanced` result state but make
  the CLI exit nonzero. Status reports schedule installation as `not-inspected`
  because it does not read crontab. The scheduled LLM cron line, still
  uninstalled by this work, uses `--all-projects` and shell-quoted paths.
  Mixed old and new Dream writer processes are unsupported during this protocol
  upgrade; stop old processes before deployment. Reservation v1 JSON remains
  readable and is not auto-migrated.

**Exit checks**

- Reservation contention, stale/unreadable owner, token mismatch, nested-call
  refusal, temp cleanup, and schedule activation guards have deterministic tests.
- One bounded live call produces a current receipt or a truthful blocker without
  mutating source Git or live MemFS.

## Final Verification Matrix

1. Format only touched files with the repository's pinned formatter.
2. Run focused Dream v2 tests after every phase.
3. Run `pnpm check`.
4. Run the complete `pnpm test` suite serially.
5. Run `pnpm test:coverage` serially and record exact totals.
6. Run native plugin validation and confirm manifest counts.
7. Confirm source Git and live MemFS invariance around any bounded provider proof.
8. Collect Code Evidence for the final diff and checks.
9. Send the plan, diff, tests, failure cases, and runtime receipt to a fresh
   independent verifier. Fix confirmed findings or record a concrete blocker.
10. Present activation options to Mahiro. Do not enable live LLM Dream or install
    a persistent schedule until the human-owned Goal criterion is verified.

## Phase Status

| Phase | Status | Completion evidence |
| --- | --- | --- |
| Runtime/provider ownership | Done | Live Agy 1.2.12 help, no-quota JSON `/model` envelope, and 14-model catalog captured. Before each of three separately authorized synthetic generation calls, the current Agy surface resolved the exact requested Opus model; the generation envelope established current normal-print fields: `structured_output` plus echoed `json_schema`. Provider-backed identity and a tool-less host guarantee are still not established. |
| Phase 1 — Pure reflector | Done | Focused 20/20, Phase 1/regression 62/62, full suite 228/228, `pnpm check`, native Biome, and pure dependency probe pass; fresh verifier reproduced the five adversarial fixes with no scoped blocker |
| Phase 2 — Dream integration | Done after live correction | The original strict adapter rejected the current Agy 1.2.12 generation envelope because `structured_output` and `json_schema` were not in its allowlist. The evidenced correction requires both fields, rejects duplicate keys over the raw envelope, compares the echoed schema semantically with the request, consumes only structured output, and keeps the display response non-authoritative. The exact transport-to-daemon regression, fresh verifier, and final bounded provider proof pass. |
| Phase 3 — Config and approval proof | Done | Focused Dream reflector/reflection 46/46, including disposable fake-transport approval-to-commit and the manual 50-step gate; `pnpm typecheck`, `pnpm check:boundaries`, native Biome, and `git diff --check` pass. Full suite not run in this phase. No provider call, live MemFS mutation, or schedule install |
| Phase 4 — Reservation and activation boundary | Done | Final focused Dream suite 64/64, typecheck, 66-file boundaries, Biome, diff check, and live-state invariance pass. Verifier tasks 8 and 9 exposed concrete state/reservation/receipt defects; fresh task 11 verified their corrections with no High/Medium blocker. The authorized provider attempt preserved reservation/cursor/proposal/memory fail-closed behavior. No active schedule; crash-after-proposal is not replay and host no-tools isolation remains unverified. |
| Final verification | Done with bounded provider proof | The live proof found current-envelope drift; verifier task 14 then found nested duplicate-key collapse in the first correction. The raw-envelope guard passes focused 66/66, full serial 274/274, coverage 87.60% lines / 77.17% branches / 92.36% functions, typecheck, 66-file boundaries, native Biome, diff check, plugin validation 14/9/3, context audit 121/0, and fresh verifier task 1 with no High/Medium blocker. The separately authorized final proof used one Agy 1.2.12 generation call, returned `ADVANCED`, created one proposal for the synthetic project owner, advanced only the disposable cursor through step 50, left disposable MemFS clean, and preserved source plus live MemFS/state invariance. Result SHA-256: `874b193358395005031c148f09b8ebaca7e42c5b0760b4b4a917d49906b35f7d`. |
| Human activation | Done — manual only | Mahiro accepted explicit `--run-now --llm` behavior. `reflection.enabled` stays false and no persistent schedule is approved or installed. |

## Completed Prerequisite

The v1.22.0 prerequisite is complete: active memory uses a 32,000 estimated-token
health gate and ordered transport steps capped at 40,000 UTF-8 bytes. The
human-approved Agy-adapted curation committed at
`1726af9973a61e46608995c428848fb4432aa955`; strict health was 24,603 / 32,000
estimated tokens and a fresh host recovered the load-bearing routing rules.
This prerequisite does not itself authorize LLM reflection or a persistent
schedule.
