---
artifact: reference-learning
authority: non-canonical
status: candidate
source: .agent-state/memory/retrospectives/2026-09/26/21.38_agy-memory-budget-and-adapted-curation.md
---

# Cross-runtime memory adaptation needs semantic receipts

**Intent**: Preserve durable human preferences when moving memory between agent runtimes without activating stale model, tool, or orchestration instructions.

**Trigger**: A memory owner is copied, restored, consolidated, or imported into a runtime whose model catalog, child-agent API, tools, commands, or execution surfaces differ from the source runtime.

**Action**:

1. Inventory every durable source unit.
2. Classify each unit as exact, adapted, merged, runtime-replaced, supporting-only, or historical.
3. Bind every non-exact unit to a concrete target unit or an explicit omission reason.
4. Verify current runtime truth from live catalogs, installed manifests, and one bounded host receipt.
5. Ask an independent verifier to find portable behavior that the adaptation silently weakened; target-prefix existence is not semantic equivalence.
6. Apply only through a fresh hash-bound human-approved curation, then verify a fresh host can recover the load-bearing rules without reading source files.

**Boundary**: Do not preserve unavailable runtime routes as active guidance merely for byte fidelity. Do not omit portable behavioral constraints merely because their original sentence also named a stale runtime. Keep historical or supporting evidence recoverable, but separate it from active execution truth.

**Rationale**: Blind copying creates contradictory active memory, while unconstrained rewriting loses human intent. An exhaustive semantic ledger plus independent counterexamples makes the adaptation reviewable and reversible without pretending that structural mapping proves behavioral preservation.

**Tags**: memory, curation, migration, runtime-adaptation, provenance, verification

