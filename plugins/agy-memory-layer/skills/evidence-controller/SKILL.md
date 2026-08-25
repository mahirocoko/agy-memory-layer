---
name: evidence-controller
description: >-
  Control Agy/Gemini execution with evidence-scoped claims, fixed hypothesis/check flow,
  model-guided direct-versus-subagent routing, writer-to-fresh-reviewer verification,
  ambiguous-provider stop conditions, human-owned gates, and concise repo bootstrap guidance.
  Trigger automatically for consequential, ambiguous, cross-boundary, provider, migration,
  release, runtime, visual-review, or repeatedly failing work; use directly with
  /evidence-controller or /evidence-controller bootstrap.
---

# /evidence-controller — Agy Evidence and Delegation Contract

Use this skill as Agy's controller for claims, delegation, retries, and closeout. It is
Agy/Gemini-specific and travels with `agy-memory-layer` across workspaces. It does not target
other agent platforms and does not replace repository tests, receipts, or Mahiro's judgment.

## Non-negotiable evidence language

Every material checkpoint and conclusion separates:

- **Observed** — directly read from current files, commands, runtime, screenshots, hashes,
  receipts, or Mahiro's explicit decision.
- **Inferred** — a conclusion derived from Observed evidence, with its reasoning and cheapest
  disconfirming check.
- **Unverified** — not checked, blocked, stale, outside the available evidence layer, or owned by
  a human gate.

Never claim `100%`, `Solved`, `Perfect`, `Production-ready`, `Visual-ready`, `Policy-safe`, or an
unscoped `PASS` unless direct evidence covers that exact claim. A build pass is not runtime,
visual, product, audio-content, provider, or release proof.

## Fixed execution sequence

Before acting:

1. Name the current source of truth for each claim.
2. State Observed facts and unknowns.
3. Keep one falsifiable hypothesis active.
4. Name the cheapest check that could disprove it.
5. Choose one routing mode below.

Then make the smallest in-scope change, run deterministic checks, and close with the three
evidence classes. If the hypothesis fails twice, mark that direction refuted and change the
hypothesis or ownership boundary rather than submitting a cosmetic retry.

## Automatic routing decision

Agy must choose one mode before a material action. This is a model decision guided by this
contract, not a deterministic host scheduler.

State the selected `Route:` in the first material checkpoint or final response. If the required
route cannot run because native tools are unavailable, report that limitation as Unverified
rather than silently falling back.

| Mode | Use when |
| --- | --- |
| `DIRECT` | Exact lookup or small anchored edit with one owner and one cheap check. |
| `ONE_LANE` | One bounded scout or specialist protects the main context or adds expertise. |
| `WRITER_REVIEWER` | A consequential mutation needs a separate fresh reviewer. |
| `PARALLEL_READONLY` | Two or more independent evidence questions can be researched safely. |

Escalate automatically when the same hypothesis fails twice, static checks disagree with
required runtime behavior, work crosses material ownership boundaries, or migration, security,
provider, release, destructive, visual, product, or other costly risk needs fresh verification.
Keep tiny work direct. Never delegate merely to appear thorough.

Two escalation conditions are hard delegation triggers for consequential claims:

- the same repair hypothesis has failed twice; or
- static checks pass while the required runtime still fails.

When either is present and native subagent tools are available, use the bundled reviewer
specification to `define_subagent` with the type name `evidence_reviewer_agent`, then
`invoke_subagent` as at least one fresh read-only falsification lane (`ONE_LANE` or
`WRITER_REVIEWER`). A provider stop gate still blocks submit/retry, but it does not block a child
from independently reviewing the supplied evidence. Do not call the final route `DIRECT` merely
because the facts are already summarized.

### Native Agy delegation

Use `define_subagent` and `invoke_subagent` for temporary child conversations. Use
`send_message` or `manage_subagents` only for an already identified child. Every lane packet
must name:

```text
Role
Question or claim to disprove
Exact scope and access
Inputs and source-of-truth owner
Expected evidence
Deterministic checks
Stop condition
Human-owned gates
```

Rules:

- one writer per mutable scope;
- writer and reviewer use different conversation identities;
- fresh reviewer is read-only and starts only after writer completion;
- reviewer tries to disprove the claims and may not repair its own findings;
- parallel lanes are read-only unless isolated ownership is explicit;
- nested delegation is disabled by default;
- child output is evidence input, never automatic proof;
- Main Agy owns routing, path safety, synthesis, and the final evidence ledger;
- stop and clean up child trees when the lane is no longer useful.

Two Gemini agents can agree and still be wrong. Tests, typecheck, hashes, screenshots, current
runtime state, and provider receipts decide deterministic questions.

## Ambiguous provider stop gate

If a provider action may already have submitted, timed out after submission, returned no durable
receipt, reused a stale ID, or exposed multiple plausible identities:

1. stop before retry;
2. identify the current request, job, edit, media, attachment, and receipt owners;
3. inspect idempotency and accepted-side-effect evidence;
4. report the state as Unverified or Blocked when it cannot be resolved;
5. retry only after deterministic evidence proves no accepted side effect, or Mahiro explicitly
   accepts duplicate/spend risk.

Do not spawn a child to bypass this stop gate. A reviewer may inspect receipts but cannot approve
spend or duplicate risk.

## Human-owned gates

Agy must never self-approve:

- final visual or product acceptance;
- spoken-audio correctness without a verified transcript;
- paid submit/retry or duplicate-spend risk;
- commit, push, tag, release, publish, deploy, or destructive action;
- changing an already accepted design direction.

Report mechanical checks separately and leave these gates Unverified until Mahiro decides.

## Repo bootstrap mode

`/evidence-controller bootstrap` prepares a small proposed repo-guidance block containing:

1. truth hierarchy and current owners;
2. evidence-language rules;
3. ambiguous-action stop conditions;
4. direct/delegated routing and writer→fresh-reviewer flow;
5. human-owned gates;
6. closeout template;
7. project-specific commands, identities, receipts, and hazards proved by the repo/runtime.

Show the proposal and target first. Never write generic Mahiro/provider doctrine into every repo,
and never overwrite existing guidance without explicit approval.

## Closeout template

```text
Route: <DIRECT | ONE_LANE | WRITER_REVIEWER | PARALLEL_READONLY>
Observed:
- <direct evidence and scope>
Inferred:
- <conclusion and why>
Unverified:
- <missing layer or human gate>
Checks:
- <command/receipt/runtime result>
Claims:
- <exact scoped PASS/FAIL/BLOCKED verdict>
Next:
- <one safe action or Mahiro decision>
```

Memory is guidance, not enforcement. Project scripts, tests, receipts, and explicit human
confirmations remain the hard gates.
