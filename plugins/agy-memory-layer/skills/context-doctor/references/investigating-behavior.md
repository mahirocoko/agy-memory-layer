# Investigating behavior

Identify the target incident from the user's symptom, session/message reference,
or time window. For a general health check, start with a bounded sample of
recent session history via `continuity_recall`.

1. **Locate the incident.** Use the supplied symptom or session reference, or
   findings from the general health check. Look for user corrections, repeated
   failed attempts, unsupported success claims, or missing memory recall across
   projects. Include a successful control example when one exists; do not select
   only failures and claim the pattern is universal.
2. **Expand around the failure.** Use `continuity_recall` (`{ "query": "<terms>", "mode": "hybrid" }`)
   to inspect relevant historical sessions. Treat recalled messages as non-binding
   historical evidence only.
3. **Follow the evidence.** Form a specific hypothesis and retrieve the next
   record needed to test it. Inspect relevant memory files (`agent_memory_read`),
   projection diagnostics (`agent_memory_manage` with `action: "status"` or
   `action: "palace"`), and commit history (`agent_memory_manage` with
   `action: "history"`). Separate what was stored, what was projected into
   `[MemFS Active Memory]`, what was retrieved on demand, and what the tool
   actually did.
4. **Identify the responsible component.** The cause may be stale or unindexed
   memory, a fact written to an on-demand file instead of an always-loaded
   `system/**` owner, conflicting instructions, failed retrieval, a skill, tool
   execution, or compaction. Do not add a behavioral rule to memory to compensate
   for a harness or schema bug.

## Available evidence

### Historical session recall (`continuity_recall`)

Use `continuity_recall` to search prior Antigravity sessions:

- `continuity_recall({ "query": "<distinctive words>", "mode": "hybrid", "limit": 10 })`

### Memory projection and commit history (`agent_memory_manage`)

- `agent_memory_manage({ "action": "status" })` — current revision, active scope,
  draft state, reflection policy, and health summary.
- `agent_memory_manage({ "action": "doctor" })` — broken links, orphan files,
  missing indexes, frontmatter warnings, and budget checks.
- `agent_memory_manage({ "action": "palace" })` — structural map
  showing which files are in the always-loaded `system` tier versus `reference`.
- `agent_memory_manage({ "action": "history", "limit": 8 })` — recent committed
  memory revisions, subjects, and changed file counts.

### Historical context limits

The current memory files are not necessarily what a past request contained.
Check `agent_memory_manage({ "action": "history" })` to see when a memory file
was actually committed relative to the incident timestamp. If a fact was still
sitting in an uncommitted draft or was committed after the target session
started, `[MemFS Active Memory]` in that earlier turn did not contain it.

## Verify a proposed fix

Recheck the original failure against the proposed change and run
`agent_memory_manage({ "action": "doctor" })`. Do not claim a fix was applied
merely because you recommended it.
