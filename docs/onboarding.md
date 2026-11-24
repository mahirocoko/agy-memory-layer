# Onboarding Guide — `agy-memory-layer`

Welcome to the **`agy-memory-layer`** repository. This guide covers the Day 1 developer setup, repository layout, and verification steps.

---

## 1. Prerequisites

Ensure your machine has the following tools installed:
- **Node.js**: `v22+`
- **Git**: `2.30+`
- **Antigravity CLI (`agy`)**: `1.1+`

---

## 2. Quick Setup & Local Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/mahirocoko/agy-memory-layer.git
cd agy-memory-layer

# Install the pinned development dependencies
pnpm install --frozen-lockfile

# Install plugin into local Antigravity CLI
./install.sh
```

### What `install.sh` does:
1. Creates the external MemFS Git repository at `~/.gemini/memory/` (when absent).
2. Seeds initial layered owners (`system/human/identity.md`, `system/human/prefs/communication.md`, `system/human/prefs/coding.md`, and `system/persona.md`) if they do not exist. Run `memory-engine.ts init` (or `migrate-v2` on an existing MemFS) to populate Tiered v2 `Core.md`, `index.md`, `<dir>/index.md`, and project baselines.
3. Creates a symlink from `plugins/agy-memory-layer/` to `~/.gemini/antigravity-cli/plugins/agy-memory-layer` (including hooks, 20 skills, and `mcp_config.json` registering the bundled `agy-memory` stdio MCP server).
4. Sets executable permissions (`chmod +x`) on all hook and utility scripts under `scripts/*.sh`.
5. Validates committed-memory PreInvocation and non-mutating Stop behavior.

---

## 3. Verifying Local Installation

Run the complete test suite:

```bash
pnpm test
```

You should see all 11 integration scenarios pass and the current Node test count reported by the
runner with zero failures. `AGENTS.md` owns the exact current-source count.

---

## 4. Key Workspaces & Paths

| Path | Purpose |
| :--- | :--- |
| `plugins/agy-memory-layer/` | Core plugin bundle source code (hooks, `mcp_config.json`, 20 skills, 9 subagent manifests, scripts, prompts) |
| `~/.gemini/memory/` | External Git-versioned MemFS repository |
| `~/.gemini/memory.state/` | Pending proposal, Dream cursor, and offline Memory Palace HTML state (`viewers/`), outside prompt memory |
| `~/.gemini/antigravity-cli/plugins/agy-memory-layer` | Global symlink target read by Antigravity CLI |
| `assets/` | Architecture and lifecycle diagrams |
| `tests/` | Automated test harness and unit coverage suites |
