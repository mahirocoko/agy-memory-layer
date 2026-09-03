---
name: contract-refine
description: >-
  Audit repository AGENTS.md hub and docs spokes for rule bloat, noise, drift, broken links,
  and missing patterns. Propose lossless consolidations and compile the contract ledger.
  Trigger on /contract-refine, /contract-refine audit, or /rules-refactor.
---

# /contract-refine — Repository Contract & Documentation Refactorer

Audits, aligns, and consolidates repository rules across `AGENTS.md` (the hub) and `docs/**` (the spokes) to eliminate rule entropy, prevent context bloat, and maintain a compiled contract ledger.

## Operating Invariant

> **Contract First, Frozen Execution**: `/contract-refine` mutates the contract (`AGENTS.md` and `docs/**`), never source code. Never run code enforcement and contract mutation in the same session on the same rule to prevent rule oscillation.

## When to Use

- When `AGENTS.md` has accumulated ad-hoc micro-rules or incident logs from recent debugging sessions.
- When new patterns were added to `AGENTS.md` but `docs/**` was neglected (hub-and-spoke drift).
- When checking for broken relative links, machine-specific absolute paths, or unreachable documentation pages.
- When preparing to compile or refresh the repository's `contract-ledger`.

## Execution Workflow

### Phase 1: Deterministic Audit & Verification
Run the contract ledger verification tool:

```bash
node --experimental-strip-types "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/../../scripts/contract-ledger.ts" verify
```

This scans:
1. **Hub Integrity**: Verifies `AGENTS.md` exists and anchors top-level invariants.
2. **Path Hygiene**: Flags machine-specific absolute paths or file URIs (e.g. `/Users/...` or `file:///...`) for conversion to environment-agnostic repository-relative markdown paths.
3. **Link Integrity**: Validates that all relative markdown links resolve to existing files.
4. **Hub-and-Spoke Reachability**: Verifies all non-historical docs in `docs/**` are reachable from `AGENTS.md` or `docs/README.md`.
5. **Deduplication**: Identifies overlapping or duplicate rule IDs.

### Phase 2: Lossless Curation & Rule Consolidation
Inspect rules identified with noise or drift. For each rule candidate, assign a lossless disposition:

- `keep`: The rule is lean, reusable, and currently proved by codebase reality.
- `merge-into:<rule-id>`: Consolidate an ad-hoc micro-rule into an existing owner (prefer merge over appending new bullets).
- `move-to:<docs/path>`: Move deep implementation guides, code examples, or checklists out of `AGENTS.md` into `docs/patterns/*.md`, leaving only a 1-2 sentence invariant in the hub.
- `historical`: Incident logs or version release notes that belong in `docs/history/` or `archives/`.
- `rejected`: Proposed rule is obsolete, contradicts current code, or creates noise.

### Phase 3: Proposal-First Review Gate
Present the proposed changes to the user as unit-based diffs:

```markdown
### Rule Disposition Proposal
- **Target**: `AGENTS.md#L45`
- **Disposition**: `merge-into:strict-type-alias`
- **Rationale**: Merges ad-hoc interface warning into existing rule 2; avoids creating redundant bullet.
- **Proposed Diff**:
```

**Never perform whole-file overwrites without explicit user approval.**

### Phase 4: Ledger Recompilation & MemFS Pointer Sync
After user confirms edits:
1. Recompile the ledger to update hash and verify zero remaining errors.
2. If an invariant affects cross-session memory, emit an explicit pointer update to MemFS (`~/.gemini/memory/projects/<slug>/system/conventions.md`) referencing `AGENTS.md` rather than duplicating the full text.
