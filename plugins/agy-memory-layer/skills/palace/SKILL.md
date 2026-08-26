---
name: palace
description: >-
  Open the Memory Palace visualizer dashboard in your browser or generate an interactive
  memory graph Artifact. Inspect the agent's knowledge graph, active project conventions,
  and Git snapshot timeline. Trigger on /palace, /mh-palace, or "open memory palace".
---

# /palace - Memory Palace Visualizer

Visual dashboard and mind-map explorer for the agent's MemFS memory blocks and Git commit history.

## Modes

1. **Browser Visualizer Mode**:
   Generates a rich, interactive HTML dashboard and opens it in your default web browser.
   ```bash
   WORKSPACE_DIR="$(pwd)"
   SCRIPT_DIR="$(dirname "$(realpath "${BASH_SOURCE[0]}")")/../../scripts"
   bash "$SCRIPT_DIR/palace-server.sh" "$WORKSPACE_DIR" --open
   ```

2. **In-Chat Artifact Mode**:
   When viewing within the terminal or chat interface, render a structured Markdown Artifact containing:
   - 🗺️ **Mermaid Graph**: Connections between focused system owners, on-demand references, and the current project.
   - 📋 **Memory Blocks Table**: Key summaries of each active memory file.
   - 📜 **Git Timeline**: Recent snapshot history.

## Mermaid Graph Template for Chat Artifacts

```mermaid
graph TD
    subgraph GlobalMemory["Global System Memory (~/.gemini/memory/system)"]
        HUMAN["👤 human/**/*.md<br/>Focused Identity & Preferences"]
        PERSONA["🤖 persona.md<br/>Agent Identity & Rules"]
        GLOBALREF["📚 ../reference/**/*.md<br/>On-Demand Index"]
    end
    
    subgraph ProjectMemory["Project Memory (~/.gemini/memory/projects/<slug>)"]
        PROJECT["🏗️ system/overview.md<br/>Architecture & Boundaries"]
        RULES["📋 system/conventions.md<br/>Conventions & Linters"]
        REFERENCES["📖 reference/**/*.md<br/>On-Demand Evidence"]
    end
    
    HUMAN --> AGENT_PROMPT["Active In-Context Window"]
    PROJECT --> AGENT_PROMPT
    RULES --> AGENT_PROMPT
    GLOBALREF -. indexed .-> AGENT_PROMPT
    REFERENCES -. indexed .-> AGENT_PROMPT
```

## Quick Commands
- `/palace` — Open the visual Memory Palace dashboard in browser.
- `/palace --summary` — Show in-chat memory graph artifact.
