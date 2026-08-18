# Project Overview — `agy-memory-layer`

`agy-memory-layer` is a stateful Git-backed memory layer, sleep-time reflection, and Memory Palace plugin for **Antigravity CLI (`agy`)**, inspired by the dual-memory and MemFS architecture of [Letta Code](https://github.com/letta-ai/letta-code).

---

## 🎯 Core Value Proposition

Standard AI coding assistants are stateless: each session starts from zero, forgetting previous bugs, architecture decisions, and developer preferences.

`agy-memory-layer` transforms Antigravity into a **stateful, long-term learning pair programmer**:
1. **MemFS (Memory Filesystem)**: Stored in an external Git repo at `~/.gemini/memory/` (zero workspace pollution).
2. **Proactive Ingestion**: PreInvocation hook injects `human.md` and `project.md` into every prompt.
3. **Autonomous Reflection (`/dream`)**: 20-step count auto-dream trigger extracts rules and commits learnings.
4. **Episodic Recall (`/recall`)**: Subword N-gram Vector Cosine Similarity searches 500+ transcripts in milliseconds.
5. **Memory Palace (`/palace`)**: Interactive browser visualizer with cache-busting headers.

---

## 🏗️ Architectural Topology

```text
Antigravity CLI Execution Runtime
  │
  ├── 1. PreInvocation Hook (scripts/hook-inject-memory.sh)
  │      └── Ingests: ~/.gemini/memory/{global/human.md, projects/<slug>/project.md}
  │
  ├── 2. Core Execution & Tool Turns (Active Chat)
  │      └── 6 First-Class Subagents (Dream, Recall, Onboarding, Memory, History, Skill Creator)
  │
  └── 3. Stop Hook (scripts/hook-auto-commit.sh)
         ├── Commits dirty changes in ~/.gemini/memory/
         └── Checks step-count (>= 20) ➜ Fires dream-daemon.js asynchronously in background
```

---

## 📦 Subsystems & Responsibilities

| Subsystem | Primary Script / Manifest | Role |
| :--- | :--- | :--- |
| **Hook Ingestion** | `scripts/hook-inject-memory.sh` | Emits `ephemeralMessage` JSON schema before turns |
| **Auto-Commit Hook** | `scripts/hook-auto-commit.sh` | Auto-commits MemFS snapshots & triggers background daemon |
| **Auto-Dream Daemon** | `scripts/dream-daemon.js` | 20-step trigger, transcript scanner, synthesis & cron |
| **Hybrid Recall Engine** | `scripts/recall-engine.js` | BM25 + Subword N-gram Vector Cosine Similarity |
| **Subagent Launcher** | `scripts/agent-launcher.js` | Dynamic manifest resolution and system prompt binding |
| **Memory Palace Visualizer**| `scripts/palace-generator.js` | Generates interactive HTML dashboard with anti-cache headers |
