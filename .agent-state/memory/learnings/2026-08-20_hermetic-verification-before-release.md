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
7. Treat committed Git `HEAD` as the active local memory projection. Stop must remain observational, while contained writers own clean-repo checks, explicit review, and targeted commits.
8. Make scope flags control actual write sets, not only labels. A global import must not fan out to project paths; project import must require its exact slug and be proven live.
9. Lifecycle ownership checks must run before acquisition or MemFS initialization and cover every registration link, including config and legacy paths.

## Why

The `agy-memory-layer` suite initially appeared fully green in its primary checkout while hiding two defects: the Palace scenario depended on the literal directory name `learn-letta-code`, and captured integration failures did not affect the process exit code. A fresh verifier disproved the completion claim by running the suite from a checkout named `repo`. The durable fix was not another assertion tweak; it was a location-independent fixture plus explicit failure propagation, verified by an intentional break that returned exit code 1.

Security had a parallel lesson: a checksum-valid backup can still contain malicious paths. Containment validation must happen for every entry before dry-run or destructive target operations.

The 2026-08-20 contract-parity repair also supersedes earlier dated claims that Stop auto-commits or launches Dream, that Letta import performs LLM grooming, or that declarative subagent manifests prove sandboxing. Current owners are `CONTRACT.md` and `docs/letta-parity.md`; older notes remain historical evidence only.

Final release-candidate evidence for the unreleased `1.12.1` repair: 11/11 integration scenarios, 18/18 Node tests, direct AGY schema validation, scoped live global/project imports, local bare-remote push/pull, disposable-HOME root/direct lifecycle coverage, and 77.35% line / 58.24% branch / 78.14% function coverage. These checks do not prove external-network, cron, host sandbox enforcement, or remote runtime dependency closure.

The missing host-level proof was then tested interactively in real AGY `1.1.16`: committed project facts appeared in an empty workspace, `/memory` reported clean active MemFS, `/remember` committed one temporary global marker path, Stop left `HEAD` unchanged, and a fresh conversation recalled the marker. The original bytes were restored through the approval writer, the marker was removed, MemFS ended clean, and the owned tmux/temp fixtures were deleted. Keep this distinct from unproven Dream/cron, external-network, and subagent-enforcement behavior. Exact evidence: `docs/agy-host-e2e-2026-08-20.md`.
The same host pass then covered `/init` in a disposable TypeScript workspace: it committed exactly `project.md` and `rules.md`, Stop left the commit unchanged, and a fresh no-tools conversation returned the injected language, entrypoint, and test command. Cleanup removed exactly those two paths and all temporary fixtures. `/sync-letta`, Dream/cron, external-network, and subagent enforcement remain outside this live proof.

## Reuse Trigger

Apply this checklist whenever a repository has a custom test orchestrator, lifecycle hooks, generated reports, import/restore tooling, or a release migration that rewrites active documentation contracts.
