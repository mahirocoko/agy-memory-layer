---
name: sync-letta
description: Synchronize core memory blocks, user preferences, domain reference notes, and project rules from Letta Code (~/.letta) into Antigravity MemFS (~/.gemini/memory).
---

# /sync-letta - Letta Code Memory Synchronization

Synchronizes core memory blocks, user preferences, domain reference notes, and workspace project rules from Letta Code (`~/.letta`) into Antigravity MemFS (`~/.gemini/memory/`).

## 🤖 4-Step Agent-Groomed Interactive Pipeline

When the user triggers `/sync-letta` or requests to sync Letta memory:

### Step 1: Scan Stateful Agents (Excluding Subagent Manifests)
Run discovery to identify stateful agent directories (`agent-*`) and ignore all `.md` subagent manifests (`git-commit.md`, `ui-review.md`, etc.):

```bash
node --experimental-strip-types plugins/agy-memory-layer/scripts/letta-sync.ts list
```

### Step 2: Interactive Selection via `ask_question`
- **If multiple stateful agents exist** (e.g. `agent-4bf7dc78...` [Primary Coding] vs `agent-b93b5702...` [Novel Writer]):
  - **MANDATORY**: You MUST ask the user first using the `ask_question` tool before syncing.
  - Present each agent's ID, summary, detected project scope, and last modified date.
  - Let the user choose whether to import as **Global User Memory** or **Project-Scoped Memory**.

### Step 3: Raw Payload Extraction
Extract the raw memory payload for the selected agent:

```bash
node --experimental-strip-types plugins/agy-memory-layer/scripts/letta-sync.ts payload --agent-id <agent-uuid>
```

### Step 4: Cognitive Grooming & Distillation by Agent
- **Strip Boilerplate**: Remove Letta prompt template guidelines ("Learn sideways...", "What are they building...", etc.).
- **Deduplicate Semantically**: Compare against existing `global/human.md` or `projects/<slug>/rules.md` to avoid redundant rules.
- **Section Synthesizing**: Synthesize only new durable facts into clean semantic sections (`## User Identity & Environment`, `## Communication & Style`, `## Coding Standards`).
- **Persist to MemFS**: Write the groomed Markdown directly into MemFS and verify token budget.
