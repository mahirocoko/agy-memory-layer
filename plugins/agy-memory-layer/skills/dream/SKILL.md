---
name: dream
description: >-
  Sleep-time reflection engine. Launches a background subagent to analyze the session's conversation
  transcript (transcript.jsonl), extract user corrections, identify project conventions, prune stale
  memories, and update MemFS git repository without interrupting workflow. Trigger on /dream, /reflect,
  or "สรุปบทเรียนเข้า memory".
---

# /dream - Sleep-Time Reflection Subagent

Inspired by Letta Code's sleep-time compute (`letta dream`), this skill launches a background subagent to review the recent conversation transcript, distill key insights, update memory blocks, and clean up outdated information.

## Workflow

### Step 1: Locate Current Transcript & Workspace
```bash
# Transcript path is typically in <appDataDir>/brain/<conversation-id>/.system_generated/logs/transcript.jsonl
WORKSPACE_DIR="$(pwd)"
PROJECT_SLUG=$(basename "$WORKSPACE_DIR" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
MEMORY_ROOT="${HOME}/.gemini/memory"
```

### Step 2: Spawn Dreaming Subagent
Invoke a subagent (`TypeName: "self"`, `Role: "Dream Reflection Subagent"`) with the following prompt:

```text
You are a Dream Reflection Subagent for MemFS.

YOUR MISSION:
1. Read recent interaction logs and extract:
   - Explicit user corrections (e.g. "don't do X", "prefer Y over Z")
   - Recurring project patterns, naming styles, architecture constraints
   - Unresolved questions or specific developer quirks
2. Review existing memory files:
   - ~/.gemini/memory/global/human.md
   - ~/.gemini/memory/projects/[PROJECT_SLUG]/project.md
   - ~/.gemini/memory/projects/[PROJECT_SLUG]/rules.md
3. Update memory files:
   - Refine and consolidate existing rules.
   - Delete obsolete or superseded notes.
   - Keep entries concise, high-signal, and well-categorized.
4. Create a dated reflection note in ~/.gemini/memory/projects/[PROJECT_SLUG]/learnings/YYYY-MM-DD_dream.md
5. Run git commit:
   git -C ~/.gemini/memory add -A && git -C ~/.gemini/memory commit -m "dream: reflection snapshot [YYYY-MM-DD HH:MM]"
```

### Step 3: Present Dream Summary
Once the subagent completes, output a concise 3-5 bullet point summary of what was learned and updated.
