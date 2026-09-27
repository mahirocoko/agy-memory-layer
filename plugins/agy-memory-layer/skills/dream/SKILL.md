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
# Inspect pending transcript notes for current project
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --status

# Inspect pending transcript notes across all projects (grouped summary)
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --status --all-projects

# Inspect pending transcript notes for a specific target project
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --status --project <slug>

# Generate and commit pending deterministic archive evidence for current project
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now

# Process and commit pending archive evidence across all initialized projects
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now --all-projects

# Process and commit pending archive evidence for a specific target project
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now --project <slug>
```

The command requires a clean MemFS repository. External Dream cursor state
records both successfully committed notes and intentionally skipped sessions
after the run; a failed learning commit does not advance that session.

## Opt-in LLM reflection

Deterministic regex Dream stays the default. Persisted `reflection.enabled`
gates automatic or scheduled LLM only and defaults to `false`. LLM cron source
exists and is unactivated. Status reports schedule installation as
`not-inspected` because it does not read crontab; that label is separate from
`reflection.enabled`. An explicit manual `--run-now --llm` is an operator
override and still runs when that flag is false. `--llm` does not change
`lastDreamedSteps` and does not run unless paired with `--run-now`. Unknown
commands and unrelated flags fail closed. No arguments still prints status.

```bash
# One explicit conversation slice. Creates pending proposals; does not commit MemFS.
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now --llm

# Bypass only the next-eligibility clock. The 50-step gate, schema, path,
# repository, snapshot, approval, and lock guards still apply.
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now --llm --force
```

Persisted reflection config accepts missing fields as the disabled defaults.
A present field that is unknown, mistyped, or outside its range makes the
reflection config invalid. LLM reflection then refuses before transport.
Regex Dream still runs and leaves that invalid reflection object unchanged.

Bounds when a field is present:

- `model` stays `claude-opus-4-6-thinking`
- `fallbackModel` stays `null`
- `maxOperations` is an integer from 1 to 8
- `memoryCharacterBudget` is an integer from 1 to 40000
- `transcriptCharacterBudget` is an integer from 1 to 60000
- `stepCountThreshold` is an integer from 50 to 10000
- `baseBackoffMinutes` stays 15 and `maxBackoffMinutes` stays 360

Current Agy 1.2.12 JSON-schema generation envelopes must also include
`structured_output` and the echoed `json_schema`. The echoed schema must match
the request semantically. Dream consumes only the structured output as the
planner result; the separate display `response` is required but
non-authoritative. Missing, extra, mismatched, malformed, duplicate-key, or
denied-action fields fail closed over the raw envelope before proposal creation
or cursor advancement.

Manual and automatic LLM eligibility both require 50 new complete transcript
steps. `--force` does not lower that gate. Backoff starts
only after a conversation has been selected. Each later failed class increments
that conversation: 15, 30, 60, 120, 240, then 360 minutes. A skipped backoff
run does not call transport, create proposals, advance
`reflection.reflectedThroughStep`, or add another failure. A successful no-op
or created proposal resets that conversation's failure record. The cursor
advances only after a valid response is classified and every supported write
proposal has been created.
Human rejection does not roll the cursor back and does not queue the same
slice again.

`--status` labels `reflection.enabled` as automatic/scheduled state, not as a
ban on the manual override. It also shows the requested model, that schedule
installation was not inspected, the automatic eligible count,
pending Dream proposal count, and per conversation cursor, lag, consecutive
failures, latest failure code/time, and next eligibility. It does not print
prompts, transcript bodies, or reference bodies. There is no in-repo Agy
statusline owner.

Review the pending files with the existing approval owner:

```bash
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-approval.ts list
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-approval.ts approve <proposalId>
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-approval.ts reject <proposalId>
```

Delete suggestions are reported as `CURATION_REQUIRED`. Dream does not delete
active memory. Removal still goes through `memory-curation.ts`.

Recovery:

- invalid config: correct `dream-state.json` under the memory state directory;
  regex cursors stay put
- backoff: wait until the reported next eligibility, or rerun with `--llm --force`
- rejected proposal: the slice stays reviewed; make a new explicit proposal if
  the memory change is still wanted
- failed model, schema, snapshot, or proposal: the reflection cursor stays, and
  the failure counter increments

Schedule source is unactivated. Preview does not mutate crontab. Guarded
installation requires `reflection.enabled=true` and
`--confirm-llm-cron=install-llm-reflection-schedule`. A successful install says
the entry is installed and eligible at the next scheduled time while enabled.
The scheduled LLM command is `--run-scheduled-llm --all-projects` with
shell-quoted node and script paths, because cron has no workspace cwd.
`--install-cron` remains the separate regex utility. Passing `--llm` to any
command other than `--run-now` exits before regex Dream or cron installation:

```bash
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --preview-llm-cron
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --inspect-reflection-reservation
```

One reservation file may block the next provider call. Acquire, release, and
reclaim take the same external writer lock as Dream state, and only for that
short mutation. Release requires the matching token and owning PID. Reclaim
requires the exact token plus a positively proven-dead PID. Unexpected liveness
errors stay ambiguous. Inspect does not delete the file. Dream does not call
`reclaimStaleMemoryWriteLock`. A writer-lock failure is infrastructure failure,
not model backoff, and must not start another provider call. If post-provider
finalization cannot finish, the reservation stays for inspect or recovery.
Whole-state Dream saves reject stale `stateRevision` values instead of
overwriting a cursor finalized after the caller's read. If final receipt
persistence fails after a successful finalization, proposals and cursor remain
paired, the result reports `ADVANCED_RECEIPT_FAILED`, and the reservation stays.
A release failure reports `RESERVATION_RELEASE_FAILED` and also leaves the
reservation inspectable. Those two partial infrastructure outcomes retain the
truthful advanced result data but exit nonzero. A present but invalid
`stateRevision` blocks regex and LLM writes instead of resetting through generic
corrupt-state recovery.
Reclaim is not crash-safe replay: a crash after proposal creation and before
cursor advance can leave pending proposals for an unadvanced slice. Mixed old
and new Dream writer processes are unsupported during this protocol upgrade;
stop old processes before deployment. Reservation v1 JSON remains readable and
is not auto-migrated.

Provider and host limits: tests use a fake transport. A live `--llm` run can
spawn the current Agy adapter, but a JSON response does not prove the requested
model was the only model used, that the host ran without tools, or that a
schedule is active. The private temp directory is deleted after the attempt
and does not prove host isolation. `gemini-4.8-high` is not a configured
fallback. Gemini 3.x is not a substitute.

## Review Contract

This workflow applies the canonical **Authority, Summaries & Historical Evidence Doctrine**
from the plugin rules.

After execution:

1. report which conversation IDs produced files and which were skipped;
2. verify every written note has explicit durable-memory intent, the correct
   workspace/project scope, and a recall-only archive target;
3. treat historical approvals, temporary grants, and one-shot decisions in transcripts as non-binding historical evidence only; never promote them to standing policy or durable rules in MemFS absent explicit, durable user wording;
4. route any proposed active system-memory rewrite through `memory-approval.ts`,
   or through `memory-curation.ts` when existing units move or disappear;
5. never promote an archive note into `working-hypothesis.md` without an explicit proposal;
6. never use `git add -A` or treat Stop as the approval boundary.

Dream outputs are historical evidence rather than fresh authorization, authoritative scope, or completion proof for future turns.

## Not Established Yet

Phase 4 source and disposable regressions are independently verified. No persistent
LLM schedule is installed. The optional regex cron command is an Agy utility
and is never launched by Stop. A dead reservation is not automatic recovery:
crash-after-proposal is not idempotent replay. Host no-tools isolation remains
unverified. A clean MemFS reflection worktree, merge policy, and post-merge
activation are not implemented. One authorized synthetic provider proof reached
a successful exact-model Agy 1.2.12 generation but failed closed on newly
observed `structured_output` and `json_schema` envelope fields. A separately
authorized diagnostic captured the exact shape, and the adapter plus raw
duplicate-key correction are covered non-live. The final bounded one-call proof
then created one explicit proposal and advanced only the disposable cursor
through step 50; the proposal was not approved or committed. Regex Dream
remains the default. Mahiro accepted LLM only as an explicit manual override;
automatic reflection and persistent scheduling remain disabled and are not
approved.
