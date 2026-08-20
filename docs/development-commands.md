# Development & Operational Commands — `agy-memory-layer`

This reference documents all testing, verification, script runners, and daemon commands available in this codebase.

---

## 🧪 Testing & Quality Assurance

Run the primary Node.js test runner suite:

```bash
# Run 11 integration scenarios plus 15 focused unit cases
pnpm test

# Run tests directly with Node 22+ type stripping
node --experimental-strip-types --test --test-concurrency=1 tests/run-test-suite.ts tests/unit-coverage.test.ts
```

---

## 🌙 Auto-Dream Background Daemon

The Auto-Dream daemon (`plugins/agy-memory-layer/scripts/dream-daemon.ts`) handles background synthesis of conversation transcripts.

```bash
# Check status of pending undreamed sessions and step count threshold
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --status

# Process and consolidate all pending sessions immediately
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now

# Force immediate synthesis regardless of session age
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now --force

# Run automatic step-count check (used by Stop Hook)
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --auto-check

# Install background cron job on macOS (runs every 2 hours)
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --install-cron

# Uninstall background cron job
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --uninstall-cron
```

---

## 🔍 Hybrid Semantic Recall Subsystem

The Hybrid Recall engine (`plugins/agy-memory-layer/scripts/recall-engine.ts`) searches historical transcripts.

```bash
# Hybrid Search (Default: BM25 + Subword N-Gram Vector Cosine Similarity)
node --experimental-strip-types plugins/agy-memory-layer/scripts/recall-engine.ts search "memory palace token calculation"

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

## 🤖 Letta Memory Sync & Cognitive Grooming Engine

Synchronizes core memory blocks from Letta Code (`~/.letta`) into Antigravity MemFS.

```bash
# List all stateful agents (excluding subagent manifests)
node --experimental-strip-types plugins/agy-memory-layer/scripts/letta-sync.ts list

# Extract raw payload for LLM cognitive grooming
node --experimental-strip-types plugins/agy-memory-layer/scripts/letta-sync.ts payload --agent-id <agent-id>

# Run dry-run sync simulation
node --experimental-strip-types plugins/agy-memory-layer/scripts/letta-sync.ts status --dry-run
```

---

## ⚡ Advanced Engine Subsystems

```bash
# 1. In-Memory TypeScript Language Inspector (in-process AST diagnostics)
node --experimental-strip-types plugins/agy-memory-layer/scripts/ts-inspector.ts diagnostics

# 2. Memory Auto-Compactor & Lossless Token Pruner
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-compactor.ts compact

# 3. Autonomous Skill Synthesizer & Auto-Promotion Engine
node --experimental-strip-types plugins/agy-memory-layer/scripts/skill-synthesizer.ts scan

# 4. Cross-Project Knowledge Synapse Matching
node --experimental-strip-types plugins/agy-memory-layer/scripts/cross-project-synapse.ts "docker setup"
```
