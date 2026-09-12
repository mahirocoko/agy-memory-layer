---
artifact: reference-learning
authority: non-canonical
status: candidate
source: .agent-state/memory/retrospectives/2026-09/12/20.24_offline-host-evidence-phase2-hardening.md
---

# Persist adverse observations before rejecting state

## Intent

Prevent an event-sourced evidence harness from turning real contradictory evidence into a false PASS by rejecting and discarding it at the persistence boundary.

## Trigger

Apply this when a persisted run has already recorded a negative acknowledgement, `not-submitted` reconciliation, cancellation, timeout, or terminal decision, but a later well-formed correlated observation reports that the supposedly absent action produced a result or side effect.

## Action

Distinguish invalid commands from adverse observations. Reject commands that would begin unauthorized work, but persist operation-compatible late observations in the immutable event stream. Move the owning reservation into an explicit permanent contradiction state, retain terminal and side-effect facts, and block reconciliation, new admission, close, seal, and PASS. Add both arrival orders to regressions: observation before reconciliation and observation after reconciliation.

## Boundary

Do not accept malformed, wrong-owner, wrong-operation, duplicate-terminal, duplicate-request, cross-run, or cross-attempt observations merely to retain bytes. Exact parsing and correlation still run first. This pattern preserves evidence; it does not authenticate the observer or replace an external checkpoint for coherent whole-store substitution.

## Rationale

If replay rejects an adverse observation before the store appends it, the active handle can remain usable while the only evidence of contradiction disappears. A later final response and close may then derive a clean score from an incomplete history. Persisting the contradiction makes the omission detectable and fail-closed.

## Tags

`event-sourcing` `receipts` `reconciliation` `false-pass` `fail-closed` `evidence-harness`
