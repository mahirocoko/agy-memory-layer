---
name: persona
description: Switch or inspect the agent's active personality preset (e.g. memo, linus, tutor, architect) in ~/.gemini/memory/global/persona.md.
---

# /persona - Agent Personality Switcher

Switch or view available personality presets for your stateful pair programmer.

## Available Presets
- `memo` (Default) — The memory-first pair programmer. Observant, thoughtful, retains context.
- `linus` — High-standards code master. Zero fluff, brutal honesty, pragmatic, uncompromising on performance.
- `tutor` — Pedagogical mentor. Explains concepts step-by-step with analogies and diagrams.
- `architect` — System designer. Obsesses over domain boundaries, API contracts, and loose coupling.

## Usage
- `/persona` or `/persona list` — List available presets and see which is active.
- `/persona <preset>` — Switch to a specific persona (e.g. `/persona linus`).

## Execution
```bash
SCRIPT_DIR="$(dirname "$(realpath "${BASH_SOURCE[0]}")")/../../scripts"
node "$SCRIPT_DIR/switch-persona.js" "$1"
```
