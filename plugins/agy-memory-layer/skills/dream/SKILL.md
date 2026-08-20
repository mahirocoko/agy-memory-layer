---
name: dream
description: Review conversation history and explicitly generate deterministic, targeted learning notes in MemFS. Trigger on /dream, /reflect, or "สรุปบทเรียนเข้า memory".
---

# /dream — Explicit Reflection and Dream Notes

Use `/dream` when the user asks to consolidate durable lessons from recent
Antigravity conversations.

## Current Reality

`dream-daemon.ts` scans available `transcript.jsonl` files, generates dated
deterministic learning notes, and commits only those note paths through the
shared memory repository boundary.

```bash
# Inspect pending transcript notes
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --status

# Generate and commit pending deterministic notes now
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now
```

The command requires a clean MemFS repository. Dream cursor state is updated
outside the repository only after the learning commit succeeds.

## Review Contract

After execution:

1. report which conversation IDs produced which learning files;
2. distinguish deterministic transcript metadata from agent-reviewed insight;
3. route any proposed `project.md` or `rules.md` rewrite through
   `memory-approval.ts propose` and explicit approval;
4. never use `git add -A` or treat Stop as the approval boundary.

## Not Established Yet

This plugin does not yet implement Letta's per-conversation cursor, one-active
reflection reservation, clean memory worktree, model-backed reflection agent,
merge policy, and post-merge activation lifecycle. The optional cron command is
an Agy utility and is never launched by Stop.
