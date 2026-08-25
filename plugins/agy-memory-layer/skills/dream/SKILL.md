---
name: dream
description: Review conversation history and explicitly generate deterministic, targeted learning notes in MemFS. Trigger on /dream, /reflect, or "สรุปบทเรียนเข้า memory".
---

# /dream — Explicit Reflection and Dream Notes

Use `/dream` when the user asks to consolidate durable lessons from recent
Antigravity conversations.

## Current Reality

`dream-daemon.ts` maps conversation IDs through local Agy `history.jsonl`, filters to
the resolved current project, and fails closed when workspace ownership is
unknown. It creates dated recall-only correction evidence only when a user prompt contains
explicit durable-memory intent containing an actionable rule or fact, such as
“remember that this project uses Yarn 4”, “จำไว้ว่าต้องใช้ pnpm”, or “ครั้งต่อไป
อย่าเขียน native dialog”. A bare “remember this” is vague and skips.
Other scanned sessions are marked skipped in external cursor state instead of
producing session-continuity boilerplate. Dream never activates or replaces the protected
working hypothesis itself.

```bash
# Inspect pending transcript notes
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --status

# Generate and commit pending deterministic archive evidence now
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now
```

The command requires a clean MemFS repository. External Dream cursor state
records both successfully committed notes and intentionally skipped sessions
after the run; a failed learning commit does not advance that session.

## Review Contract

After execution:

1. report which conversation IDs produced files and which were skipped;
2. verify every written note has explicit durable-memory intent, the correct
   workspace/project scope, and a recall-only archive target;
3. route any proposed `project.md` or `rules.md` rewrite through
   `memory-approval.ts propose` and explicit approval;
4. never promote an archive note into `working-hypothesis.md` without an explicit proposal;
5. never use `git add -A` or treat Stop as the approval boundary.

## Not Established Yet

This plugin does not yet implement Letta's per-conversation cursor, one-active
reflection reservation, clean memory worktree, model-backed reflection agent,
merge policy, and post-merge activation lifecycle. The optional cron command is
an Agy utility and is never launched by Stop.
