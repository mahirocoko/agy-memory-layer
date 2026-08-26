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
  ├── Active conversation / explicit skills
  │     ├── Evidence Controller direct/delegated routing
  │     ├── contained targeted memory writers
  │     ├── 7 declarative subagent role manifests
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
| Evidence Controller | `skills/evidence-controller/SKILL.md` | Agy-native claim, delegation, retry, and human-gate procedure |
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

- isolated, cursor-based model reflection with a clean memory worktree;
- a release-acquiring updater with validation and rollback;
- self-contained runtime artifacts for remote TypeScript execution;
- host-level evidence for subagent capability enforcement.
