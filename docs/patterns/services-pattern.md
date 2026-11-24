# Services & Execution Patterns — `agy-memory-layer`

## 1. Committed PreInvocation Projection

```text
[Antigravity CLI Invocation]
            │
            ▼
[scripts/hook-inject-memory.sh]
            │
            ├── Resolve and validate project identity
            ├── Compile layered/legacy global + current-project files from Git HEAD
            ├── Select one canonical committed working hypothesis
            ├── Fail closed on malformed or stray active learning metadata
            ├── Report dirty/conflict state without injecting it
            └── Estimate prompt budget
            │
            ▼
{
  "injectSteps": [
    { "ephemeralMessage": "authority stanza, then [MemFS Transport 1/N] and the first chunk" },
    { "ephemeralMessage": "[MemFS Transport 2/N] through a later document tail" }
  ]
}
```

A disposable Agy 1.2.11 / Opus 4.6 session received one 100,098-character
message. The host omitted bytes and recorded `<truncated 51851 bytes>` around
the end of `coding.md`, so a later owner's tail was NOT VISIBLE. Injection now
packs active content into ordered steps of at most 40,000 UTF-8 bytes. That is
byte-bounded transport chunking, not a content ceiling. A follow-up probe on the
same host/model path received all five ordered messages without a transcript
truncation marker, and the model quoted unique tail rules from both `coding.md`
and `workflow.md`. This verifies the current bounded fixture, not every future
host version. The 32,000-token gate still does not drop active content, and it
is counted before chunking.

The shell wrapper has one TypeScript implementation path and fails clearly when
Node 22+ or the source file is unavailable. It does not contain a weaker fallback
that reads the working tree.

Workspace identity is shared with onboarding and Dream. Existing committed child
scopes win; otherwise Git-root identity prevents generic nested paths such as
`apps/web` from silently becoming project memory.

## 2. Non-Mutating Stop

```text
[Agent Finishes Turn]
            │
            ▼
[scripts/hook-memory-status.sh]
            │
            └── Inspect clean / dirty / conflict / uninitialized state
            │
            ▼
{"decision": "stop"}
```

Stop never stages, commits, deletes locks, or launches Dream. Explicit writers
own persistence. Regex Dream is a separate manual or explicitly installed cron
surface. `reflection.enabled` does not install or start LLM scheduling. The LLM
cron installer is source-only. Status reports it as not inspected, and no
schedule is activated. The scheduled LLM line uses `--all-projects`. Phase 4
source and disposable regressions plus the bounded provider proposal flow are
independently verified. Mahiro accepted explicit manual LLM use only; automatic
reflection and persistent scheduling remain disabled.

## 3. Targeted Memory Writer

```text
[Explicit writer or approved proposal]
            │
            ▼
[scripts/memory-repository.ts]
            │
            ├── Validate relative path and project slug
            ├── Reject symlink escape and non-clean repository
            ├── Write atomically
            ├── Reject unrelated dirty paths
            └── Commit declared pathspecs only
```

Pending proposal and Dream cursor state is stored in `memory.state/` beside the
repository, not inside it.

## 4. Declarative Subagent Resolver

```text
[Subagent Request: "dream_agent"]
            │
            ▼
[scripts/agent-launcher.ts]
            │
            ├── Read agents/dream_agent.json
            ├── Resolve prompts/subagents/dream_subagent.md
            └── Return role, model tier, and declared capability intent
```

The returned object is a specification. The resolver does not establish an OS
sandbox or prove that the Agy host denies undeclared tools.

## 5. Evidence Controller Delegation

```text
[Material Agy task]
        │
        ▼
[skills/evidence-controller/SKILL.md]
        │
        ├── Classify Observed / Inferred / Unverified
        ├── Keep one falsifiable hypothesis
        ├── Choose DIRECT / ONE_LANE / WRITER_REVIEWER / PARALLEL_READONLY
        ├── Use native Agy child conversations when justified
        └── Close with deterministic checks and human-owned gates
```

This is a model-guided procedure, not a deterministic scheduler. Native child
conversation evidence proves delegation capability; it does not make two-agent
agreement proof or authorize provider retry, spend, commit, release, or human
acceptance.

## 6. Bundled Stdio MCP Server & Tiered v2 Engine

```text
[Antigravity CLI (mcp_config.json)]
        │
        ▼
[scripts/mcp-server.sh -> scripts/memory-mcp-server.ts ("agy-memory")]
        │
        ├── agent_memory_read    (committed + draft overlay, bounded Thai/English lexical search)
        ├── agent_memory_edit    (CAS expectedHash, patch/replace/append, Lossless Retention Guard, read_only check)
        ├── agent_memory_commit  (re-checks base HEAD & lock, auto-syncs <dir>/index.md & index.md)
        ├── agent_memory_manage  (status, doctor, palace, palace_export, history, init, migrate-v2, cleanup, remember, policy)
        ├── agent_memory_reflect (plan / apply / mark_reflected; inherits active/policy model)
        └── continuity_recall    (non-binding historical Antigravity transcript search)
```

All Tiered v2 mutations pass through `scripts/memory-engine.ts` under the external shared writer lock (`withMemoryWriteLock`) with secret scanning (`findSecretLikeContent`), `read_only: true` preservation, and atomic draft-to-commit verification.

## 7. Offline Memory Palace Renderer

```text
[scripts/palace-server.sh]
        │
        ├── default ──► [scripts/palace-render.ts]
        │                   └── single-file offline Letta-grammar HTML written at 0600 to ~/.gemini/memory.state/viewers/palace-<slug>.html
        │
        └── --legacy ─► [scripts/palace-generator.ts]
                            └── legacy dashboard written to /tmp/agy-memory-palace.html (or explicit path)
```

Both renderers read strictly from committed Git `HEAD` via `inspectCommittedMemoryProjection()`, failing closed on mixed legacy/layered layouts and never promoting uncommitted working-tree content into Core cards.
