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
1. Creates the external MemFS Git repository at `~/.gemini/memory/`.
2. Seeds initial `human.md` and `persona.md` templates if they do not exist.
3. Creates a symlink from `plugins/agy-memory-layer/` to `~/.gemini/antigravity-cli/plugins/agy-memory-layer`.
4. Sets executable permissions (`chmod +x`) on all hook and utility scripts.

---

## 3. Verifying Local Installation

Run the complete test suite:

```bash
pnpm test
```

You should see all 11 integration scenarios and 16 Node test-runner tests pass.

---

## 4. Key Workspaces & Paths

| Path | Purpose |
| :--- | :--- |
| `plugins/agy-memory-layer/` | Core plugin bundle source code (hooks, manifests, scripts, prompts) |
| `~/.gemini/memory/` | External Git-versioned MemFS repository |
| `~/.gemini/antigravity-cli/plugins/agy-memory-layer` | Global symlink target read by Antigravity CLI |
| `assets/` | Architecture and lifecycle diagrams |
| `tests/` | Automated test harness and unit coverage suites |
