# Development & Operational Commands — `agy-memory-layer`

This reference documents all testing, verification, script runners, and daemon commands available in this codebase.

---

## 🧪 Testing & Quality Assurance

Run the primary Node.js test runner suite:

```bash
# Run 11 integration scenarios plus 18 focused unit cases
pnpm test

# Run tests directly with Node 22+ type stripping
node --experimental-strip-types --test --test-concurrency=1 tests/run-test-suite.ts tests/unit-coverage.test.ts
```

---

## 🌙 Deterministic Dream Note Utility

`dream-daemon.ts` scans Antigravity transcripts and writes deterministic learning notes. It is separate from Stop and does not provide Letta's model-backed isolated reflection worktree.

```bash
# Check status of pending undreamed sessions and step count threshold
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --status

# Process and consolidate all pending sessions immediately
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now

# Force immediate synthesis regardless of session age
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now --force

# Run the step-count check explicitly (Stop does not invoke it)
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --auto-check

# Install background cron job on macOS (runs every 2 hours)
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --install-cron

# Uninstall background cron job
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --uninstall-cron
```

Cron installation is an explicit user choice. Treat it as an Agy utility, not as proven Letta reflection parity.

---

## 🔍 Hybrid Semantic Recall Subsystem

The Hybrid Recall engine (`plugins/agy-memory-layer/scripts/recall-engine.ts`) searches historical transcripts.

```bash
# Hybrid Search (Default: BM25 + Subword N-Gram Vector Cosine Similarity)
node --experimental-strip-types plugins/agy-memory-layer/scripts/recall-engine.ts "memory palace token calculation"

# List the 20 most recent available transcript sessions
node --experimental-strip-types plugins/agy-memory-layer/scripts/recall-engine.ts list

# Vector Semantic Search Only (Concept / Synonym matching)
node --experimental-strip-types plugins/agy-memory-layer/scripts/recall-engine.ts search "how did we fix caching" --semantic

# Keyword Exact Match Only (BM25 exact token matching)
node --experimental-strip-types plugins/agy-memory-layer/scripts/recall-engine.ts search "palace-generator.ts" --keyword

# Search another topic with the default result limit
node --experimental-strip-types plugins/agy-memory-layer/scripts/recall-engine.ts search "subagents"
```

---

## 🏛️ Memory Palace Generator

Generates the interactive Memory Palace HTML visualizer.

```bash
# Generate the default /tmp/agy-memory-palace.html and open it
bash plugins/agy-memory-layer/scripts/palace-server.sh --open

# Generate to an explicit path without opening a browser
bash plugins/agy-memory-layer/scripts/palace-server.sh /tmp/agy-memory-palace.html
```

---

## 🎭 Persona Switcher

Switches or inspects agent personality presets in `~/.gemini/memory/global/persona.md`.

```bash
# List available persona presets
node --experimental-strip-types plugins/agy-memory-layer/scripts/switch-persona.ts --list

# Switch to Linus (Stern Master) preset
node --experimental-strip-types plugins/agy-memory-layer/scripts/switch-persona.ts linus

# Switch to Memo (Default Letta Code) preset
node --experimental-strip-types plugins/agy-memory-layer/scripts/switch-persona.ts memo
```

---

## 🤖 Explicit Letta Markdown Import

Inspects and imports selected Letta Markdown into Antigravity MemFS. This is a one-way adapter, not live sync or LLM grooming.

```bash
# List all stateful agents (excluding subagent manifests)
node --experimental-strip-types plugins/agy-memory-layer/scripts/letta-sync.ts list

# Extract the selected raw payload for review
node --experimental-strip-types plugins/agy-memory-layer/scripts/letta-sync.ts payload --agent-id <agent-id>

# Run dry-run sync simulation
node --experimental-strip-types plugins/agy-memory-layer/scripts/letta-sync.ts status --dry-run --agent-id <agent-id> --target-scope global

# Run a reviewed project route live
node --experimental-strip-types plugins/agy-memory-layer/scripts/letta-sync.ts sync --agent-id <agent-id> --target-scope project --project-slug <slug> --confirm-import
```

---

## ⚡ Advanced Engine Subsystems

```bash
# 1. In-Memory TypeScript Language Inspector (in-process AST diagnostics)
node --experimental-strip-types plugins/agy-memory-layer/scripts/ts-inspector.ts diagnostics

# 2. Read-only Markdown Memory Maintenance Analysis
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-compactor.ts compact --dry-run

# 3. Skill Candidate Synthesizer
node --experimental-strip-types plugins/agy-memory-layer/scripts/skill-synthesizer.ts scan

# 4. Cross-Project Knowledge Synapse Matching
node --experimental-strip-types plugins/agy-memory-layer/scripts/cross-project-synapse.ts "docker setup"
```
