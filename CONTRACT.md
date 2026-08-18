# Architecture & Design Contract: `agy-memory-layer` Plugin

**Version**: 1.0.0  
**Target Platform**: Antigravity CLI (`agy`)  
**Status**: Proposal & Blueprint  
**Inspired by**: Letta Code (`letta-ai/letta-code`) Dual-Memory & MemFS Architecture  

---

## 1. Executive Summary & Objective

`agy-memory-layer` is an installable, self-contained **Antigravity CLI Plugin** that brings Letta Code's stateful memory architecture to Antigravity CLI. 

It provides:
1. **In-Context Core Memory Blocks** (`human.md`, `persona.md`, `project.md`) dynamically injected into the agent's context window.
2. **Git-Backed MemFS** stored outside the workspace (in `~/.gemini/memory/`) with automatic version control, diff tracking, and rollback capabilities.
3. **Lifecycle Hooks** for automatic memory ingestion (`PreInvocation`) and automated Git snapshots (`Stop`).
4. **Sleep-Time Dreaming / Reflection (`/dream`)** using subagents that read session transcripts (`transcript.jsonl`) to consolidate learnings and prune outdated data.
5. **One-Command Management**: Clean installation, `agy plugin enable/disable` support, and a safe uninstaller.

---

## 2. Architecture & File Structure

### 2.1 Plugin Bundle (`plugins/agy-memory-layer/` &rarr; `~/.gemini/antigravity-cli/plugins/agy-memory-layer/`)

```text
plugins/agy-memory-layer/
├── plugin.json                  # Plugin manifest metadata
├── hooks.json                   # AGY lifecycle event hook definitions
├── rules/
│   └── AGENTS.md                # Memory behavioral guidelines & format directives
├── skills/
│   ├── memory/
│   │   └── SKILL.md             # /memory: Inspect active blocks & git status
│   ├── remember/
│   │   └── SKILL.md             # /remember: Explicitly record a preference or rule
│   ├── dream/
│   │   └── SKILL.md             # /dream: Sleep-time reflection over transcript.jsonl
│   ├── doctor/
│   │   └── SKILL.md             # /doctor: Memory integrity & drift audit
│   └── palace/
│       └── SKILL.md             # /palace: Visual Memory Palace dashboard & timeline viewer
└── scripts/
    ├── hook-inject-memory.sh    # PreInvocation: Reads memory & outputs ephemeralMessage
    ├── hook-auto-commit.sh      # Stop: Performs git add & commit on memory repository
    ├── palace-generator.js      # Memory Palace HTML generator
    ├── palace-server.sh         # Generates/opens interactive local Memory Palace HTML viewer
    ├── install.sh               # Bootstraps memory git repo & installs plugin
    └── uninstall.sh             # Safely disables and removes the plugin
```

### 2.2 Memory Storage Layout (`~/.gemini/memory/`)

All memory is decoupled from individual workspace trees and maintained as an independent, portable Git repository:

```text
~/.gemini/memory/                # Standalone Git Repository
├── .git/                        # Full commit history & snapshots
├── global/
│   ├── human.md                 # User profile, coding preferences, quirks, tone
│   └── persona.md               # Agent personality & core capabilities
└── projects/
    └── <project-slug>/          # Project-scoped memory (derived from git remote / repo path)
        ├── project.md           # Architecture decisions, tech stack, key contracts
        ├── rules.md             # Project-specific coding rules & conventions
        └── learnings/           # Dated learning logs (YYYY-MM-DD_<topic>.md)
```

---

## 3. Core Component Specifications

### 3.1 Plugin Manifest (`plugin.json`)

```json
{
  "name": "memfs",
  "version": "1.0.0",
  "description": "Stateful Git-backed MemFS and sleep-time reflection for Antigravity CLI",
  "author": "Mahiro",
  "license": "MIT"
}
```

---

### 3.2 Lifecycle Hooks Contract (`hooks.json`)

```json
{
  "memfs-injector": {
    "PreInvocation": [
      {
        "type": "command",
        "command": "./scripts/hook-inject-memory.sh",
        "timeout": 5
      }
    ]
  },
  "memfs-auto-commit": {
    "Stop": [
      {
        "type": "command",
        "command": "./scripts/hook-auto-commit.sh",
        "timeout": 10
      }
    ]
  }
}
```

#### Hook Behavior Details:
1. **`PreInvocation` (`hook-inject-memory.sh`)**:
   - Receives AGY context payload (`workspacePaths`, `conversationId`) via `stdin`.
   - Resolves active project slug from `workspacePaths[0]`.
   - Reads `~/.gemini/memory/global/human.md` and `~/.gemini/memory/projects/<slug>/project.md`.
   - Outputs JSON payload to `stdout` injecting an `ephemeralMessage` block into the agent's context.

2. **`Stop` (`hook-auto-commit.sh`)**:
   - Runs when the agent execution loop finishes.
   - Checks if `~/.gemini/memory` has uncommitted changes (`git status --porcelain`).
   - If changes exist, executes:
     `git -C ~/.gemini/memory add . && git -C ~/.gemini/memory commit -m "memfs auto-snapshot: [$(date +%Y-%m-%d_%H%M%S)]"`

---

### 3.3 Skills Suite Specification

| Skill Name | Trigger / Command | Purpose & Execution Flow |
| :--- | :--- | :--- |
| **`memory`** | `/memory` or `/mh-memory` | Displays current active memory blocks (`human`, `persona`, `project`), Git status, and recent memory commit history. |
| **`remember`** | `/remember <fact/rule>` | Appends or updates specific memory files (`human.md` or `project.md`) and immediately creates an uncommitted/committed memory state. |
| **`dream`** | `/dream` or `/reflect` | Spawns a background reflection subagent. The subagent reads the session's `transcript.jsonl`, extracts user feedback, lessons learned, and corrections, cleans outdated entries, and updates the memory files. |
| **`doctor`** | `/doctor` or `/memory-doctor` | Runs an audit against the active codebase to detect if memory rules or architecture assumptions have drifted from codebase reality. |
| **`palace`** | `/palace` or `/mh-palace` | Visual Memory Palace viewer: Generates an interactive visual map of all memory nodes, file connections, commit history timeline, and recent memory diffs (as both an AGY Artifact and an openable local HTML viewer in browser). |

---

### 3.4 In-Context Memory Schemas

#### Global User Memory (`global/human.md`)
```markdown
# Human Profile & User Preferences

## Communication & Language
- Language: Thai (informal/technical) or English as requested.
- Tone: Direct, concise, no unnecessary pleasantries.

## General Coding Standards
- Strict typing, explicit error boundaries.
- Package Manager: Always use exact flag (`-E`) when installing packages.
```

#### Project Memory (`projects/<project-slug>/project.md`)
```markdown
# Project Memory: <Project Name>

## Overview & Domain
- Core purpose, domain concepts, key business logic.

## Technical Architecture
- Tech stack, directory layout conventions, core APIs.

## Active Conventions & Decisions
- Architectural decisions made in past sessions.
```

---

### 3.5 Memory Palace Visualizer Specification (`/palace` & `palace-server.sh`)

The **Memory Palace** gives the operator a visual dashboard to inspect the agent's knowledge graph and memory timeline:
1. **Interactive Visual Dashboard**:
   - Renders a clean, modern web UI (or Markdown Artifact with Mermaid graph) mapping all global and project memory blocks.
   - Shows connection lines between Rules, Human preferences, and Project conventions.
2. **Git Snapshot Timeline & Diff Viewer**:
   - Displays recent memory git commits with clickable diffs to see *when* and *why* a memory was learned or changed.
   - Allows verifying agent dreaming changes over time.
3. **Execution Modes**:
   - **TUI/Artifact Mode**: Renders an in-chat interactive Artifact with Mermaid nodes and Markdown tables.
   - **Browser Mode (`palace-server.sh`)**: Generates an interactive standalone HTML single-page dashboard at `/tmp/agy-memory-palace.html` and opens it in the default web browser (`open /tmp/...`).

---

## 4. Installation, Lifecycle & Uninstallation

### 4.1 Installation (`scripts/install.sh`)
1. Create `~/.gemini/memory/` and initialize a local Git repository if not present.
2. Populate default template files (`global/human.md`, `global/persona.md`).
3. Symlink/copy the `memfs` plugin directory to `~/.gemini/antigravity-cli/plugins/memfs`.
4. Validate that `agy plugin list` recognizes the plugin.

### 4.2 Activation Controls (via AGY CLI)
- **Disable Plugin**: `agy plugin disable memfs` (disables all hooks & skills without deleting data).
- **Enable Plugin**: `agy plugin enable memfs`.

### 4.3 Uninstallation (`scripts/uninstall.sh`)
Provides two clean options:
- **Option 1 (Safe Uninstall)**: Removes the plugin from `~/.gemini/antigravity-cli/plugins/memfs`. Retains all Git memory in `~/.gemini/memory/` for future use.
- **Option 2 (Complete Purge)**: Removes the plugin and deletes `~/.gemini/memory/` after user confirmation.

---

## 5. Development Roadmap & Milestones

- [x] **Milestone 1**: Scaffolding & Manifest (`plugin.json`, `rules/AGENTS.md`, memory folder init scripts)
- [x] **Milestone 2**: Ingestion & Persistence Hooks (`hook-inject-memory.sh`, `hook-auto-commit.sh`, `hooks.json`)
- [x] **Milestone 3**: Core Skills Suite (`/memory`, `/remember`, `/dream`, `/doctor`, `/palace`)
- [x] **Milestone 4**: Palace Visualizer UI (`palace-server.sh` & `palace-generator.js` standalone interactive HTML dashboard)
- [x] **Milestone 5**: Installer (`install.sh`) & Uninstaller (`uninstall.sh`)
- [x] **Milestone 6**: End-to-End Testing (Testing context injection, auto-commit, dreaming, palace viewer, and clean uninstallation)

