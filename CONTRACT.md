# Architecture & Design Contract: `agy-memory-layer` Plugin

**Version**: 1.9.0  
**Target Platform**: Antigravity CLI (`agy`)  
**Status**: Active Production Standard  
**Inspired by**: Letta Code (`letta-ai/letta-code`) Dual-Memory & MemFS Architecture  

---

## 1. Executive Summary & Objective

`agy-memory-layer` is an installable, self-contained **Antigravity CLI Plugin** that transforms Antigravity CLI into a stateful, long-term learning pair programmer.

It provides:
1. **In-Context Core Memory Blocks** (`human.md`, `persona.md`, `project.md`, `rules.md`) dynamically injected into the agent's context window before every turn.
2. **Git-Backed MemFS** stored outside the workspace (in `~/.gemini/memory/`) with automatic version control, diff tracking, and rollback capabilities.
3. **Lifecycle Hooks** for sub-15ms memory ingestion (`PreInvocation`) and sub-30ms automated Git snapshots (`Stop`).
4. **Codebase Onboarding & Initializer (`/init`)**: Automatically scans a newly opened project (package manifests, entry points, linters, test runner, scripts, existing documentation) and seeds `project.md` and `rules.md` on Day 1.
5. **Sleep-Time Dreaming / Reflection (`/dream`)**: Uses background subagents that read session transcripts (`transcript.jsonl`) to consolidate learnings, resolve contradictions, and prune outdated data.
6. **Auto-Dream Background Daemon (`dream-daemon.ts`)**: Automatically discovers unconsolidated sessions across `brain/` and synthesizes durable learning logs into MemFS without manual intervention.
7. **Historical Learnings Search (`/memory search <query>`)**: Enables quick retrieval of past architectural decisions and bug fixes across all historical session logs.
8. **Multi-Device Remote Sync (`/sync`)**: Syncs MemFS to a private GitHub/GitLab repository across development machines.
9. **Memory Palace (`/palace`)**: Interactive visual knowledge graph, Synapse network, and Git timeline viewer with anti-cache headers.
10. **Tamper-Proof Backups (`tools/memory-backup.ts`)**: Standalone export/import with SHA-256 integrity verification.
11. **Persona Preset Switcher (`/persona`)**: Instantly switches agent personality (`memo`, `linus`, `tutor`, `architect`, `kawaii`, `blank`).
12. **In-Memory TypeScript Language Inspector (`ts-inspector.ts`)**: Sub-50ms AST diagnostics, hover type signatures, definition resolution, and cross-file references without spawning slow external compiler processes.
13. **Memory Auto-Eviction & Token Compactor Engine (`memory-compactor.ts`)**: Deterministic token budget enforcement, section-scoped rule deduplication, empty section pruning, and historical archival compaction.
14. **Comprehensive Prompt Assets Warehouse (`prompts/`)**: Categorized prompt library covering `system/`, `persona/`, `human/`, `subagents/`, and `alerts/`.
15. **Hybrid Semantic Recall Engine (`/recall`)**: Subword n-gram vector embeddings + BM25 keyword fusion across 500+ past Antigravity conversation transcripts with cosine similarity scoring.
16. **Synapse Linking (`[[link]]`)**: Wikilink-style connections across memory blocks with interactive graph navigation.
17. **Proactive Memory Budget Guard**: Real-time token monitoring and gentle pruning reminders.

---

## 2. Architecture & File Structure

### 2.1 Plugin Bundle (`plugins/agy-memory-layer/` &rarr; `~/.gemini/antigravity-cli/plugins/agy-memory-layer/`)

```text
plugins/agy-memory-layer/
├── plugin.json                  # Plugin manifest metadata
├── hooks.json                   # AGY lifecycle event hook definitions
├── rules/
│   └── AGENTS.md                # Autonomous memory behavioral guidelines & proactive directives
├── skills/
│   ├── init/
│   │   └── SKILL.md             # /init: Auto-scan codebase & seed project memory on Day 1
│   ├── memory/
│   │   └── SKILL.md             # /memory & /memory search: Inspect blocks, history & search
│   ├── recall/
│   │   └── SKILL.md             # /recall: Search across all past conversation transcripts
│   ├── remember/
│   │   └── SKILL.md             # /remember: Explicitly record a preference or rule
│   ├── persona/
│   │   └── SKILL.md             # /persona: Switch active personality preset
│   ├── dream/
│   │   └── SKILL.md             # /dream: Sleep-time reflection over transcript.jsonl
│   ├── doctor/
│   │   └── SKILL.md             # /doctor: Memory integrity & drift audit
│   ├── palace/
│   │   └── SKILL.md             # /palace: Visual Memory Palace dashboard & timeline viewer
│   ├── sync/
│   │   └── SKILL.md             # /sync: Remote Git synchronization with private repos
│   └── update/
│       └── SKILL.md             # /update: Update plugin to latest version preserving MemFS
└── scripts/
    ├── hook-inject-memory.sh    # PreInvocation: Reads memory, monitors budget & outputs ephemeralMessage
    ├── hook-auto-commit.sh      # Stop: Performs git add & commit on memory repository
    ├── init-project-memory.js   # Codebase scanner engine for /init
    ├── memory-search.js         # Keyword & regex search engine for /memory search
    ├── recall-engine.js         # Episodic conversation search engine for /recall
    ├── switch-persona.js        # Persona preset manager for /persona
    ├── sync-memory.sh           # Remote Git sync manager (push/pull/status)
    ├── palace-generator.js      # Memory Palace HTML generator
    ├── palace-server.sh         # Generates/opens interactive local Memory Palace HTML viewer
    ├── update.sh                # Automated in-place plugin updater
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
    └── <project-slug>/          # Project-scoped memory (derived from workspace slug)
        ├── project.md           # Architecture decisions, tech stack, key contracts
        ├── rules.md             # Project-specific coding rules & conventions
        └── learnings/           # Dated learning logs (YYYY-MM-DD_<topic>.md)
```

---

## 3. Core Component Specifications

### 3.1 Plugin Manifest (`plugin.json`)

```json
{
  "name": "agy-memory-layer",
  "version": "1.1.0",
  "description": "Stateful Git-backed MemFS, sleep-time reflection, and codebase onboarding for Antigravity CLI",
  "author": "Mahiro",
  "license": "MIT"
}
```

---

### 3.2 Extended Skills Suite Specification

| Skill Name | Trigger / Command | Purpose & Execution Flow |
| :--- | :--- | :--- |
| **`init`** | `/init` or `/agy-memory-layer:init` | **Codebase Scanner & Onboarding**: Automatically inspects package manifests (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, etc.), entry points, linters, test commands, and documentation, then generates high-signal `project.md` and `rules.md` in MemFS immediately. |
| **`memory`** | `/memory` or `/memory search <query>` | Displays active memory blocks, Git commit timeline, or searches across historical `learnings/` logs for matching lessons. |
| **`recall`** | `/recall <query>` or `/recall list` | **Episodic Recall**: Searches across all 500+ historical conversation transcripts for discussions, bug fixes, decisions, and code snippets. |
| **`remember`** | `/remember <fact/rule>` | Appends or updates specific memory files (`human.md` or `rules.md`) and immediately commits a snapshot. |
| **`persona`** | `/persona <preset>` | Switches or inspects the active personality preset (`memo`, `linus`, `tutor`, `architect`, `custom`) in `global/persona.md`. |
| **`dream`** | `/dream` or `/reflect` | Spawns a background reflection subagent. The subagent reads session transcripts (`transcript.jsonl`), extracts user corrections and conventions, cleans outdated entries, and writes dated learning logs. |
| **`doctor`** | `/doctor` or `/memory-doctor` | Runs an audit against the active codebase to detect if memory rules or architecture assumptions have drifted from codebase reality. |
| **`palace`** | `/palace` or `/palace --summary` | Visual Memory Palace viewer: Generates an interactive visual map of all memory nodes, file connections, commit history timeline, and diffs (standalone HTML viewer or Mermaid Artifact). |
| **`sync`** | `/sync` or `/sync setup <url>` | Syncs MemFS with a remote private Git repository (GitHub/GitLab) across multiple machines with automatic push/pull. |
| **`update`** | `/update` | Automated in-place plugin updater: Pulls latest release, preserves all stored MemFS data, and updates hooks/skills. |

---

## 4. Codebase Scanner Engine (`scripts/init-project-memory.js`)

The scanner inspects the active workspace heuristics:
1. **Manifest Detectors**:
   - Node: `package.json`, `pnpm-workspace.yaml`, `bun.lockb`, `yarn.lock`
   - Rust: `Cargo.toml`
   - Go: `go.mod`
   - Python: `pyproject.toml`, `requirements.txt`, `Pipfile`
   - Cloudflare: `wrangler.jsonc`, `wrangler.toml`
   - Docker: `Dockerfile`, `docker-compose.yml`
2. **Directory & Route Analysis**:
   - Detects `src/`, `app/`, `routes/`, `components/`, `lib/`, `tests/`, `tools/`, `cmd/`
3. **Build & Test Scripts Extraction**:
   - Extracts exact scripts from `package.json` / Makefiles / cargo configurations.
4. **Existing Rule Ingestion**:
   - Checks `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `.cursorrules`, `.eslintrc*`, `biome.json`
5. **Output Generation**:
   - Outputs pristine `projects/<slug>/project.md` and `projects/<slug>/rules.md` and triggers Git commit.

---

## 5. Development Roadmap & Milestones

- [x] **Milestone 1**: Scaffolding & Manifest (`plugin.json`, `rules/AGENTS.md`)
- [x] **Milestone 2**: Ingestion & Persistence Hooks (`hook-inject-memory.sh`, `hook-auto-commit.sh`, `hooks.json`)
- [x] **Milestone 3**: Core Skills Suite (`/memory`, `/remember`, `/dream`, `/doctor`, `/palace`)
- [x] **Milestone 4**: Palace Visualizer UI (`palace-server.sh` & `palace-generator.js` HTML dashboard with 1200px centered card, Git Diff bar, and real disk paths)
- [x] **Milestone 5**: Tamper-Proof Backup & Restore Utility (`tools/memory-backup.ts` with SHA-256 verification)
- [x] **Milestone 6**: End-to-End Test Suite (11/11 Automated Suites passing in < 2.5s)
- [x] **Milestone 7**: Codebase Scanner & Day 1 Onboarding (`/init` Skill & `scripts/init-project-memory.js`)
- [x] **Milestone 8**: Historical Memory Search Engine (`/memory search` & `scripts/memory-search.js`)
- [x] **Milestone 9**: Remote Git Synchronization (`/sync` & `scripts/sync-memory.sh`)
- [x] **Milestone 10**: Universal One-Liner Installer (`curl | bash`), `/update` Subsystem & v1.1.0 GitHub Release

---

## 6. Official Release & Distribution Contract

- **Release Tag**: `v1.1.0`
- **GitHub Repository**: `https://github.com/mahirocoko/agy-memory-layer`
- **Zero-Clone Quickstart**:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/mahirocoko/agy-memory-layer/main/install.sh | bash
  ```
- **In-Chat Auto-Update**:
  ```text
  /update
  ```
