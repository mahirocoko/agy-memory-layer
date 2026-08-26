---
name: init
description: Onboard a newly opened codebase into MemFS by scanning repository architecture and seeding the active project-memory layout after explicit confirmation.
---

# /init - Codebase Memory Initializer & Day 1 Onboarding

Onboard a newly opened codebase into MemFS by scanning repository architecture,
package manifests, entry points, linters, scripts, and documentation. In layered
mode it seeds `system/overview.md` and `system/conventions.md`; legacy mode keeps
the historical `project.md` and `rules.md` fallback.

## When to Use
- When opening or cloning a project for the first time.
- When `PreInvocation` detects an uninitialized workspace in `~/.gemini/memory/projects/<slug>/`.
- When the codebase undergoes a major framework rewrite or overhaul and memory needs to be re-baselined.

## Execution

```bash
SCRIPT_DIR="$(dirname "$(realpath "${BASH_SOURCE[0]}")")/../../scripts"
node --experimental-strip-types "$SCRIPT_DIR/init-project-memory.ts" --confirm-init "$@"
```

## Options
- `/init` — After user invocation, passes `--confirm-init`, scans the workspace,
  and creates the two project-system baseline owners for the selected layout.
- `/init --force` — Re-scans codebase and forces overwriting baseline memory blocks.

## What It Does
1. Detects languages, package managers, and framework ecosystems (`Node`, `Rust`, `Go`, `Python`, `Cloudflare Workers`, `Docker`, etc.).
2. Analyzes entry points (`src/index.ts`, `app/page.tsx`, `main.go`, `src/main.rs`, etc.).
3. Extracts test runners (`vitest`, `jest`, `pytest`, `cargo test`) and linters (`eslint`, `oxlint`, `biome`).
4. Generates the initial overview and conventions inside `~/.gemini/memory/projects/<slug>/system/` in layered mode.
5. Requires a clean MemFS repository and commits only the two generated project files.
