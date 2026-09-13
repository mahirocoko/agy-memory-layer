# Project Overview — `agy-memory-layer`

`agy-memory-layer` is an Antigravity CLI plugin that combines a user-owned,
Git-backed Markdown memory repository with committed prompt projection, scoped
project context, conversation recall, and optional learning utilities.

The project is inspired by Letta Code, but adapts the behavior to one Agy user
repository rather than copying Letta's per-agent storage and service APIs. The
canonical boundary is [`letta-parity.md`](./letta-parity.md).

## Core Value

1. **External MemFS** — `~/.gemini/memory/` stays outside application repos.
2. **Committed projection** — PreInvocation reads active context from Git `HEAD`.
3. **Focused layered memory** — global/current-project system bodies stay
   active; detailed reference bodies remain on-demand and archives stay inert.
4. **Explicit persistence** — writers validate containment, serialize through a
   shared lock, and commit only reviewed owned paths.
5. **Observational Stop** — session end reports state without creating a commit
   or starting background work.
6. **Separate recall** — `/recall` searches Antigravity transcripts, while
   `/memory search` searches Markdown memory.
7. **Evidence-controlled execution** — Agy separates claim classes, chooses
   direct or bounded native-subagent routes, and preserves human-owned gates.
8. **Agy extensions** — Memory Palace, archived correction evidence, project
   onboarding, Letta import, persona presets, backup/restore, and read-only
   Markdown maintenance analysis.

## Runtime Topology

```text
Antigravity CLI
  │
  ├── PreInvocation
  │     └── hook-inject-memory.ts
  │           └── compile layered/legacy committed HEAD through layered-memory.ts
  │
  ├── PreToolUse
  │     └── hook-pre-tool-use.ts
  │           └── classify command, write, dependency, and subagent safety boundaries
  │
  ├── Active conversation / explicit skills
  │     ├── Evidence Controller direct/delegated routing
  │     ├── contained targeted memory writers
  │     ├── 9 declarative subagent role manifests
  │     └── recall / palace / doctor / sync utilities
  │
  └── Stop
        └── hook-memory-status.ts
              └── report clean / dirty / conflict / uninitialized
```

## Subsystem Owners

| Subsystem | Primary owner | Current boundary |
| --- | --- | --- |
| Committed prompt projection | `scripts/layered-memory.ts` | Selects layered/legacy ownership from `HEAD`; dirty content is not active |
| Working hypothesis | `scripts/active-learning.ts` | One canonical protected hypothesis; malformed/stray active state fails closed |
| Tool safety classification | `scripts/tool-guard.ts`, `scripts/hook-pre-tool-use.ts` | Classifies selected command/write/subagent shapes; configured destructive patterns are denied and configured mutations escalated, but coverage and action-specific authorization binding remain partial |
| Evidence Controller | `skills/evidence-controller/SKILL.md` | Agy-native claim, delegation, retry, and human-gate procedure |
| Repository contract refinement and alignment | `skills/contract-refine/SKILL.md`, `skills/contract-align/SKILL.md`, `scripts/contract-ledger*.ts`, `scripts/contract-snapshot.ts` | Explicit approval binds complete final owner bytes; evaluation and verdict bind verified snapshot plus exact targets; heuristic review remains bounded evidence |
| Execution-continuity pilot | `docs/execution-continuity-pilot.md`, `docs/execution-continuity-stage1-evidence-2026-09-11.md`, `scripts/execution-continuity-stage1.ts`, `tests/execution-continuity*.test.ts`, `tests/support/execution-continuity-*.ts` | Stage 0 deterministic fixture preflight plus audited Stage 1 no-advance evidence and corrected test-only scorer; no runtime state or supervisor |
| Memory repository contract | `scripts/memory-repository.ts`, `scripts/memory-write-lock.ts` | Containment, status, serialization, atomic writes, targeted commits |
| Workspace identity | `scripts/workspace-identity.ts` | Shared child/root/remote scope resolution and history mapping |
| Stop status | `scripts/hook-memory-status.ts` | Observational only |
| Project initialization | `scripts/init-project-memory.ts` | Scoped scan and two-file commit |
| Approval | `scripts/memory-approval.ts` | Explicit proposals with base and content receipts |
| Curation | `scripts/memory-curation.ts` | Exhaustive dispositions plus exact provenance archive |
| Layered migration | `scripts/layered-memory-migration.ts` | Read-only plan, hash-confirmed apply, additive rollback |
| Transcript recall | `scripts/recall-engine.ts` | Local BM25 + n-gram search |
| Dream correction archive | `scripts/dream-daemon.ts` | Local Agy workspace history plus actionable durable intent; writes recall-only evidence and skips unknown/vague input |
| Memory health | `tools/memory-health.ts` | Deterministic budget, scope, residue, and low-signal checks |
| Letta import | `scripts/letta-sync.ts` | Explicit agent selection and reference-only import |
| Memory Palace | `scripts/palace-generator.ts` | Read-only committed-projection visualization |
| Subagent manifests | `agents/*.json`, `scripts/agent-launcher.ts` | Declarative intent, not proven sandboxing |

## Known Gaps

- durable mission state, finite completion supervision, compaction recovery,
  and final-response blocking remain unimplemented; the approved
  [`execution-continuity pilot`](./execution-continuity-pilot.md) completed Stage 0 and a separately
  authorized 15-run Stage 1 screen, but neither candidate advanced; no Stage 2 rerun or runtime
  design is selected or authorized;
- isolated, cursor-based model reflection with a clean memory worktree;
- a release-acquiring updater with validation and rollback;
- self-contained runtime artifacts for remote TypeScript execution;
- host-level evidence for subagent capability enforcement.

The [Phase 4A external-product attribution baseline](./agy-main-phase4a-external-product-attribution-2026-09-13.md)
adds longitudinal real-project evidence to these gaps. It supports Agy as a high-throughput primary
implementation lane, refutes memory loss as the primary explanation for the sampled failures, and
limits the next candidate work to observing the real PreToolUse/host boundary plus material-claim
review binding before any new live canary.
