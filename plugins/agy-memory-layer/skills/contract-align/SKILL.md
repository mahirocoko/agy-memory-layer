---
name: contract-align
description: >-
  Evaluate and surgically align target code against a verified frozen repository-contract snapshot.
  Trigger on /contract-align, /contract-align <files...>, or /code-align.
---

# /contract-align — Snapshot-Bound Contract Alignment

Canonical rule owners are repository `AGENTS.md` plus non-historical `docs/**/*.md` only. MemFS, summaries, generated reviews, and implementation bytes are evidence, never active rule owners.

## Frozen workflow

1. Resolve exact target files, including untracked files and rename destinations.
2. Recover the explicitly approved snapshot. Verify it immediately:

```bash
node --experimental-strip-types <contract-ledger.ts> snapshot-verify --snapshot <snapshot.json>
```

3. Evaluate exact target bytes and retain the JSON receipt:

```bash
node --experimental-strip-types <contract-ledger.ts> eval --snapshot <snapshot.json> --json <targets...> > <eval.json>
```

Never use `--unsafe-live-contract` in contract-align. It is non-compliant low-level/manual test mode. If an explicit `--ledger` is used, a missing or snapshot-stale file is a hard failure. Never use `--deterministic-only` to bypass heuristic review.

4. For each unevaluated rule, audit the exact owner, scope, and claim by trying to disprove it with a concrete counterexample. If the heuristic surface is too broad, partition it into separable scopes or stop; never bulk-pass.
5. A single fresh read-only reviewer is required by default when the current agent authored, refined, disputed, or implemented the claim under review. Otherwise delegation is optional. Use multiple reviewers only for genuinely separable scopes. Reviewer evidence is neither authority nor a vote; Main must reject unsupported findings and remains responsible for checking the exact rule owner/scope and one counterexample.
6. Review JSON must bind the receipt's exact `evaluationHash`. Every `pass`, `not-applicable`, or `violation` entry needs a non-empty bounded rationale and at least one bounded evidence entry (`source`, `detail`).
7. Reverify the snapshot and current target bytes at verdict:

```bash
node --experimental-strip-types <contract-ledger.ts> verdict --snapshot <snapshot.json> --eval <eval.json> --review <review.json>
```

The verdict gate rejects stale contract owners, role/path changes, changed targets, mismatched evaluation hashes, incomplete review, and violations. Its output is snapshot-bound evaluated evidence only: never describe it as “certified by the engine,” authenticated human approval, or semantic proof beyond the assessed scope.

## Change boundary

Apply only surgical source changes justified by an active rule ID, owner, and intersecting scope. Never edit contract owners. Suppress disputed diffs and route them to a later `/contract-refine`. Re-run snapshot verification, evaluation, review, verdict, focused tests, and typecheck after changes. Report exact assessed scope and counts; do not claim universal compliance. Never auto-commit.
