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
3. **Explicit persistence** — writers validate containment and commit only owned
   paths; project architecture/rules require review.
4. **Observational Stop** — session end reports state without creating a commit
   or starting background work.
5. **Separate recall** — `/recall` searches Antigravity transcripts, while
   `/memory search` searches Markdown memory.
6. **Agy extensions** — Memory Palace, explicit-intent Dream notes, project
   onboarding, Letta import, persona presets, backup/restore, and read-only
   Markdown maintenance analysis.

## Runtime Topology

```text
Antigravity CLI
  │
  ├── PreInvocation
  │     └── hook-inject-memory.ts
  │           └── read committed HEAD through memory-repository.ts
  │
  ├── Active conversation / explicit skills
  │     ├── contained targeted memory writers
  │     ├── 6 declarative subagent role manifests
  │     └── recall / palace / doctor / sync utilities
  │
  └── Stop
        └── hook-memory-status.ts
              └── report clean / dirty / conflict / uninitialized
```

## Subsystem Owners

| Subsystem | Primary owner | Current boundary |
| --- | --- | --- |
| Committed prompt projection | `scripts/hook-inject-memory.ts` | Reads `HEAD`; dirty content is not active |
| Memory repository contract | `scripts/memory-repository.ts` | Containment, status, atomic writes, targeted commits |
| Workspace identity | `scripts/workspace-identity.ts` | Shared child/root/remote scope resolution and history mapping |
| Stop status | `scripts/hook-memory-status.ts` | Observational only |
| Project initialization | `scripts/init-project-memory.ts` | Scoped scan and two-file commit |
| Approval | `scripts/memory-approval.ts` | Auto global policy; explicit project/rules policy |
| Transcript recall | `scripts/recall-engine.ts` | Local BM25 + n-gram search |
| Deterministic Dream notes | `scripts/dream-daemon.ts` | Local Agy workspace history plus actionable durable intent; unknown/vague input skips |
| Memory health | `tools/memory-health.ts` | Deterministic budget, scope, residue, and low-signal checks |
| Letta import | `scripts/letta-sync.ts` | Explicit agent selection and targeted import |
| Memory Palace | `scripts/palace-generator.ts` | Read-only visualization |
| Subagent manifests | `agents/*.json`, `scripts/agent-launcher.ts` | Declarative intent, not proven sandboxing |

## Known Gaps

- isolated, cursor-based model reflection with a clean memory worktree;
- a release-acquiring updater with validation and rollback;
- self-contained runtime artifacts for remote TypeScript execution;
- host-level evidence for subagent capability enforcement.
