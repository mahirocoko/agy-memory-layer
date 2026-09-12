---
name: contract-refine
description: >-
  Refine active repository contracts through evidence-classified proposals, scoped user approval,
  and an approval-bound frozen snapshot. Trigger on /contract-refine or /rules-refactor.
---

# /contract-refine — Evidence-Bound Contract Refinement

Refine only `AGENTS.md` plus non-historical `docs/**/*.md`. Do not edit implementation code.

## Truth and authority

- **Observed reality**: directly verified current consumer/source or runtime behavior. It is not automatically desired policy.
- **Accepted requirement**: directly attributable user wording or approval with exact project, topic, and scope.
- **Unresolved direction**: preference, conflict, ambiguity, or evidence gap. It cannot be included in an approved snapshot.

Evidence classes are `current-user`, `historical-user`, `repo-current`, `runtime-current`, `agent-summary`, and `memory-supporting`. User evidence requires an exact message/time locator and minimal quote. Summaries and MemFS are supporting only and cannot authorize an item. Classify evidence relationships as current, supporting, or conflicting.

## Procedure

1. Inspect current repository consumers and source. Build one canonical owner map for every active owner, including unchanged owners, with path, role, and SHA-256.
2. Recover direct-user evidence. Report sources/sessions, time range, queries, truncation, inaccessible material, and gaps. Search snippets are discovery only.
3. Run one cheap disconfirming check per material claim: counterexample, conflicting owner, consumer mismatch, or runtime contradiction.
4. Prepare the exact proposed final owner bytes in a temporary location. Derive the complete sorted `finalOwners` manifest from those bytes before approval. Do not write proposed owner bytes into the repository yet.
5. Present a reproducible diff, proposal ID/hash, scoped item IDs, and this evidence table:

| Item ID | Claim/disposition | Truth class | Owner paths | Evidence class + relationship | Exact locator | Minimal excerpt | Retrieval coverage/gap | Disconfirming check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

6. Obtain exact approval for that proposal ID/hash and selected item IDs. A changed selection or changed final byte requires a new proposal/hash and new approval.
7. Only after approval, write exactly the proposed bytes. Snapshot creation fails unless current complete owner bytes equal `finalOwners`; Git cleanliness is not authority.
8. Create and verify the snapshot, then stop. Do not write MemFS, commit, enforce, or broaden scope.

## Executable receipt shape

```json
{
  "proposal": {
    "version": "1.0.0",
    "id": "proposal-id",
    "retrieval": { "sources": ["..."], "timeRange": "...", "queries": ["..."], "gaps": [] },
    "finalOwners": [{ "path": "AGENTS.md", "role": "hub", "contentHash": "<sha256>" }],
    "items": [{
      "id": "item-id", "paths": ["AGENTS.md"], "summary": "...",
      "truthClass": "accepted-requirement", "disposition": "keep",
      "evidence": [{ "class": "current-user", "source": "...", "locator": "message/time", "excerpt": "..." }]
    }]
  },
  "approval": {
    "version": "1.0.0", "proposalId": "proposal-id", "proposalHash": "<sha256>",
    "decision": "approved", "approvedItemIds": ["item-id"], "approvedBy": "recorded-user",
    "decisionLocator": "message/time"
  }
}
```

`finalOwners` must include all active hub/spoke owners, not only changed paths. Approval is cooperative evidence, not cryptographic authentication. A one-time baseline adoption still requires a `keep`/adopt item, complete `finalOwners`, stable proposal hash, and explicit approval.

```bash
node --experimental-strip-types <contract-ledger.ts> snapshot --proposal <proposal.json> --approval <approval.json> --output <snapshot.json>
node --experimental-strip-types <contract-ledger.ts> snapshot-verify --snapshot <snapshot.json>
```

Later align requests reuse this verified snapshot while owner bytes remain identical; source-only edits and commits do not require reapproval.
