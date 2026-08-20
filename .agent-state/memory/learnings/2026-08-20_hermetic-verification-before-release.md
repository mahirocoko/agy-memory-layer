# Durable Lesson — Hermetic Verification Before Release

**Date**: 2026-08-20
**Tags**: `testing`, `hermeticity`, `failure-propagation`, `context-contracts`, `security`, `external-state`

## Rule

Before calling a multi-scenario CLI suite or plugin migration release-ready:

1. Run it from a checkout whose directory name differs from the primary workspace.
2. Inject one controlled scenario failure and prove the outer command exits nonzero.
3. Give tests a unique disposable HOME, MemFS, temp root, worktree source, and remote configuration.
4. Validate untrusted bundle paths completely before dry-run, cleaning, filesystem probes, or writes.
5. Audit active producers as well as docs: runtime fallbacks, generated prose templates, reports, skills, prompts, and version surfaces.
6. Never update user-owned external state merely because a repo checklist calls it a version surface; an explicit no-touch boundary wins.

## Why

The `agy-memory-layer` suite initially appeared fully green in its primary checkout while hiding two defects: the Palace scenario depended on the literal directory name `learn-letta-code`, and captured integration failures did not affect the process exit code. A fresh verifier disproved the completion claim by running the suite from a checkout named `repo`. The durable fix was not another assertion tweak; it was a location-independent fixture plus explicit failure propagation, verified by an intentional break that returned exit code 1.

Security had a parallel lesson: a checksum-valid backup can still contain malicious paths. Containment validation must happen for every entry before dry-run or destructive target operations.

## Reuse Trigger

Apply this checklist whenever a repository has a custom test orchestrator, lifecycle hooks, generated reports, import/restore tooling, or a release migration that rewrites active documentation contracts.
