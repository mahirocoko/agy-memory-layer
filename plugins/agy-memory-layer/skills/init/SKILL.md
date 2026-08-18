# /init - Codebase Memory Initializer & Day 1 Onboarding

Onboard a newly opened codebase into MemFS by automatically scanning repository architecture, package manifests, entry points, linters, scripts, and documentation, then seeding `project.md` and `rules.md` on Day 1.

## When to Use
- When opening or cloning a project for the first time.
- When `PreInvocation` detects an uninitialized workspace in `~/.gemini/memory/projects/<slug>/`.
- When the codebase undergoes a major framework rewrite or overhaul and memory needs to be re-baselined.

## Execution

```bash
WORKSPACE_DIR="$(pwd)"
SCRIPT_DIR="$(dirname "$(realpath "${BASH_SOURCE[0]}")")/../../scripts"
node "$SCRIPT_DIR/init-project-memory.js" "$WORKSPACE_DIR"
```

## Options
- `/init` — Scans current workspace and creates `project.md` + `rules.md` (skips if already exists).
- `/init --force` — Re-scans codebase and forces overwriting baseline memory blocks.

## What It Does
1. Detects languages, package managers, and framework ecosystems (`Node`, `Rust`, `Go`, `Python`, `Cloudflare Workers`, `Docker`, etc.).
2. Analyzes entry points (`src/index.ts`, `app/page.tsx`, `main.go`, `src/main.rs`, etc.).
3. Extracts test runners (`vitest`, `jest`, `pytest`, `cargo test`) and linters (`eslint`, `oxlint`, `biome`).
4. Writes initial high-signal `project.md` and `rules.md` to `~/.gemini/memory/projects/<slug>/`.
5. Automatically commits a snapshot to Git MemFS.
