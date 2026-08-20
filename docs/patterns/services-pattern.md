# Services & Execution Patterns — `agy-memory-layer`

This guide explains the architectural patterns used across hooks, background daemons, and subagent launcher services in `agy-memory-layer`.

---

## 1. The PreInvocation Injection Service Pattern

```text
[Antigravity CLI Invocation]
            │
            ▼
[scripts/hook-inject-memory.sh]
            │
            ├── 1. Read ~/.gemini/memory/global/human.md
            ├── 2. Read ~/.gemini/memory/projects/<slug>/project.md
            ├── 3. Read ~/.gemini/memory/projects/<slug>/rules.md
            ├── 4. Calculate Character-to-Token Budget Estimate
            │
            ▼
[Output JSON Envelope]
{
  "injectSteps": [
    { "ephemeralMessage": "🧠 **[MemFS Active Memory]** ... " }
  ]
}
```

---

## 2. The Stop Hook & Non-Blocking Async Daemon Pattern

```text
[Agent Finishes Turn]
            │
            ▼
[scripts/hook-auto-commit.sh]
            │
            ├── 1. Synchronous: Check Git Status in ~/.gemini/memory/
            │      └── If dirty: git add -A && git commit -m "memfs auto-snapshot: ..."
            │
            ├── 2. Asynchronous (Detached Node Process):
            │      └── node --experimental-strip-types scripts/dream-daemon.ts --auto-check
            │          └── Checks if active session >= 20 steps ➜ synthesizes learning
            │
            ▼
[Output JSON] ──► {"decision": "stop"}
```

---

## 3. Dynamic Subagent Resolver Pattern (`agent-launcher.ts`)

```text
[Subagent Request: "dream_agent"]
            │
            ▼
[scripts/agent-launcher.ts]
            │
            ├── 1. Read plugins/agy-memory-layer/agents/dream_agent.json
            ├── 2. Resolve System Prompt from prompts/subagents/dream_subagent.md
            ├── 3. Combine Tool Permissions & Model Tiers ("inherit" | "flash" | "pro")
            │
            ▼
[Return Resolved Specification Object]
{
  name: "dream_agent",
  role: "Dream Reflection Subagent",
  modelTier: "inherit",
  enableWriteTools: true,
  systemPrompt: "<Markdown content>"
}
```
