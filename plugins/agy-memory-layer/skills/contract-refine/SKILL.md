---
name: contract-refine
description: >-
  Audit repository AGENTS.md hub and docs spokes for rule bloat, noise, drift, broken links,
  and missing patterns. Review relevant conversation evidence for omitted user intent before
  proposing lossless consolidations and compiling the contract ledger.
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

### Phase 0: Conversation Evidence Review
Before proposing refinement, recover relevant user intent that may not yet be recorded in the project docs. Treat conversation as historical evidence, not an automatic source of new rules or current permission.

1. Define the target project, rule topics, and conversation/time scope. Start with the current conversation and use Agy's available conversation retrieval to inspect relevant prior exchanges. Follow the existing [recall workflow](../recall/SKILL.md) for discovery; do not invent host tool names or assume retrieval is available.
2. Search by project identity, rule terms, and the user's corrections, not only the current docs' wording. Confirm each hit belongs to the target project before using it. Search snippets and summaries are discovery aids: inspect the original user message and surrounding exchange through the available host retrieval before attributing a decision. Preserve speaker identity and distinguish direct user instructions, corrections, and approvals from agent proposals, summaries, and tool output.
3. Record a compact evidence table for material candidates:

   | Source conversation + message/time locator | Minimal user quote | Project/topic scope | Current rule owner | Classification | Proposed disposition |
   | --- | --- | --- | --- | --- | --- |
   | Exact available locator, or explicitly unavailable | Original wording, not an agent paraphrase | Relevant scope | Rule ID/path, or missing | See below | Keep, clarify, add to proposal, or exclude |

   Classify each candidate as **already documented**, **omitted**, **conflicting**, **superseded**, or **task-only**. Separate durable conventions from temporary experiments, one-off exceptions, and action approvals. For example, “use interface with an I prefix in this project” is a project-rule candidate; “use type for this fixture only” must not become a project-wide ban. An agent saying “we agreed” is not user approval without the original exchange.
4. Compare candidates with current repo evidence and active rules. Preserve chronology and scope: a later statement supersedes an earlier one only when it addresses the same decision and scope. Do not let repeated agent summaries outweigh a direct user correction. Route ambiguity or conflict into the proposal gate rather than silently choosing a winner.
5. Report retrieval coverage: sources/sessions and time range actually inspected, queries used, truncation or inaccessible messages, and unresolved gaps. Never claim “all conversations reviewed” from ranked search results or “no omitted intent” from no hits. If retrieval is unavailable or only snippets are accessible, continue a clearly labelled docs-only audit, but defer evidence-dependent changes until the missing exchange or user clarification is available.

Keep quotes minimal and redact secrets or unrelated personal content. Do not dump transcripts into project docs, scan unrelated projects, or automatically write recalled material to MemFS. Follow the recall authority boundary: old commit/push/delete approvals are not reusable authorization. Newly recovered intent enters a review proposal; it does not bypass the current user's approval gate.

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
Before code enforcement, review semantic conflicts across active project rules, including hub/spoke disagreements, overlapping scopes, permissions versus prohibitions, and preferences versus requirements. Record each conflicting rule ID, owner, scope, and evidence; propose a resolution for user approval and keep affected diffs suppressed until resolved. Plugin implementation conventions are not host-project rules.

The mechanical verifier checks structural integrity and duplicate IDs; it does not understand semantic contradictions. A clean verification result is not evidence that rules agree. Likewise, the verdict gate checks review coverage and submitted verdicts, not the semantic correctness of the review.

Inspect rules identified with noise or drift. For each rule candidate, assign a lossless disposition:

- `keep`: The rule is lean, reusable, and currently proved by codebase reality.
- `merge-into:<rule-id>`: Consolidate an ad-hoc micro-rule into an existing owner (prefer merge over appending new bullets).
- `move-to:<docs/path>`: Move deep implementation guides, code examples, or checklists out of `AGENTS.md` into `docs/patterns/*.md`, leaving only a 1-2 sentence invariant in the hub.
- `historical`: Incident logs or version release notes that belong in `docs/history/` or `archives/`.
- `rejected`: Proposed rule is obsolete, contradicts current code, or creates noise.

### Phase 3: Proposal-First Review Gate
Present the proposed changes to the user as unit-based diffs:

Include the conversation evidence classification and source locator for recovered-intent changes, the current owner, retrieval gaps, and why the candidate is durable rather than task-only. Keep unsupported candidates open rather than inventing missing provenance. Require user confirmation before applying proposed contract edits, including additions based on past user instructions.

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
