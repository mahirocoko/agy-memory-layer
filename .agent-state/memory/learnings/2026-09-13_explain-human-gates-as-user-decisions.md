---
artifact: reference-learning
authority: non-canonical
status: candidate
source: .agent-state/memory/retrospectives/2026-09/13/19.11_phase4b-agy-main-release-candidate.md
---

# Explain Human Gates as User Decisions

**Tags:** human-gate, acceptance, communication, evidence, release

## Intent

Make a human-owned acceptance gate understandable and actionable without requiring the human to
decode test reports, evidence schemas, or verifier terminology.

## Trigger

Work reaches a human approval or acceptance criterion and the supporting evidence contains
specialized terms, expected negative controls, multiple bounded proofs, or important deferred
capabilities.

## Action

Before asking for acceptance, explain in plain operational language:

1. what behavior changed in normal use;
2. what the strongest evidence directly proves;
3. why any alarming result such as an expected `fail` is or is not a defect;
4. what the candidate still cannot do; and
5. exactly what accepting the gate authorizes next.

Then give a grounded recommendation and let the human make the decision.

## Boundary

Do not replace evidence with persuasion or hide material limitations. A plain-language explanation
translates the evidence; it does not strengthen it, self-verify the human criterion, or expand the
approved release/action scope.

## Rationale

A technically explicit gate can still be unusable when its owner cannot infer the practical
decision from raw metrics and review labels. Translating proof into behavior and boundaries makes
human acceptance informed rather than ceremonial.

