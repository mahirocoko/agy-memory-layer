# Services & Execution Patterns — `agy-memory-layer`

## 1. Committed PreInvocation Projection

```text
[Antigravity CLI Invocation]
            │
            ▼
[scripts/hook-inject-memory.sh]
            │
            ├── Resolve and validate project identity
            ├── Read global/project files from Git HEAD
            ├── Read at most two committed learning excerpts
            ├── Report dirty/conflict state without injecting it
            └── Estimate prompt budget
            │
            ▼
{
  "injectSteps": [
    { "ephemeralMessage": "🧠 **[MemFS Active Memory]** ..." }
  ]
}
```

The shell wrapper has one TypeScript implementation path and fails clearly when
Node 22+ or the source file is unavailable. It does not contain a weaker fallback
that reads the working tree.

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
own persistence. Dream is a separate manual or explicitly installed cron
surface.

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
