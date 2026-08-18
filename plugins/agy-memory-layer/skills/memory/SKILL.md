---
name: memory
description: >-
  Inspect, list, and review active MemFS memory blocks (global human profile, project context,
  rules, and recent git snapshot logs). Trigger when user types /memory, asks to inspect memory,
  or wants to review what the agent currently remembers.
---

# /memory - MemFS Inspector & Status

Inspect and manage long-term Git-backed memory blocks stored at `~/.gemini/memory/`.

## Memory Hierarchy

```
~/.gemini/memory/
├── global/
│   ├── human.md                 # User profile, style, habits
│   └── persona.md               # Agent identity & tone
└── projects/
    └── <project-slug>/          # Project-specific memory
        ├── project.md           # Project architecture & domain logic
        ├── rules.md             # Project-specific coding rules
        └── learnings/           # Dated learning logs
```

## Step 1: Detect Project Slug & Workspace
```bash
WORKSPACE_DIR="$(pwd)"
PROJECT_SLUG=$(basename "$WORKSPACE_DIR" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
MEMORY_ROOT="${HOME}/.gemini/memory"
PROJECT_DIR="${MEMORY_ROOT}/projects/${PROJECT_SLUG}"
```

## Step 2: Read Active Memory Blocks
Read and present the following blocks in a formatted overview:
1. `~/.gemini/memory/global/human.md`
2. `~/.gemini/memory/global/persona.md`
3. `~/.gemini/memory/projects/<project-slug>/project.md` (if exists)
4. `~/.gemini/memory/projects/<project-slug>/rules.md` (if exists)

## Step 3: Git Status & Recent Commit History
```bash
git -C "$MEMORY_ROOT" status --short
git -C "$MEMORY_ROOT" log -n 5 --oneline --decorate
```

## Output Presentation
Render a clear summary showing:
- 👤 **Global User Profile**: Key preferences currently active
- 📁 **Active Project Context**: Active conventions for this workspace
- 📜 **Recent Snapshots**: Last 5 Git memory commits with timestamps
