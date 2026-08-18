# Development & Operational Commands — `agy-memory-layer`

This reference documents all testing, verification, script runners, and daemon commands available in this codebase.

---

## 🧪 Testing & Quality Assurance

Run the primary Node.js test runner suite:

```bash
# Run all 9 unit & integration test suites
npm test

# Run tests directly with Node 22+ type stripping
node --experimental-strip-types --test tests/run-test-suite.js tests/unit-coverage.test.js
```

---

## 🌙 Auto-Dream Background Daemon

The Auto-Dream daemon (`plugins/agy-memory-layer/scripts/dream-daemon.js`) handles background synthesis of conversation transcripts.

```bash
# Check status of pending undreamed sessions and step count threshold
node plugins/agy-memory-layer/scripts/dream-daemon.js --status

# Process and consolidate all pending sessions immediately
node plugins/agy-memory-layer/scripts/dream-daemon.js --run-now

# Force immediate synthesis regardless of session age
node plugins/agy-memory-layer/scripts/dream-daemon.js --run-now --force

# Run automatic step-count check (used by Stop Hook)
node plugins/agy-memory-layer/scripts/dream-daemon.js --auto-check

# Install background cron job on macOS (runs every 2 hours)
node plugins/agy-memory-layer/scripts/dream-daemon.js --install-cron

# Uninstall background cron job
node plugins/agy-memory-layer/scripts/dream-daemon.js --uninstall-cron
```

---

## 🔍 Hybrid Semantic Recall Subsystem

The Hybrid Recall engine (`plugins/agy-memory-layer/scripts/recall-engine.js`) searches historical transcripts.

```bash
# Hybrid Search (Default: BM25 + Subword N-Gram Vector Cosine Similarity)
node plugins/agy-memory-layer/scripts/recall-engine.js search "memory palace token calculation"

# Vector Semantic Search Only (Concept / Synonym matching)
node plugins/agy-memory-layer/scripts/recall-engine.js search "how did we fix caching" --semantic

# Keyword Exact Match Only (BM25 exact token matching)
node plugins/agy-memory-layer/scripts/recall-engine.js search "palace-generator.js" --keyword

# Limit top results and filter by workspace
node plugins/agy-memory-layer/scripts/recall-engine.js search "subagents" --limit 3 --workspace learn-letta-code
```

---

## 🏛️ Memory Palace Generator

Generates the interactive Memory Palace HTML visualizer.

```bash
# Generate palace.html in current conversation directory and open browser
node plugins/agy-memory-layer/scripts/palace-generator.js

# Generate without auto-opening browser
node plugins/agy-memory-layer/scripts/palace-generator.js --no-open
```

---

## 🎭 Persona Switcher

Switches or inspects agent personality presets in `~/.gemini/memory/global/persona.md`.

```bash
# List available persona presets
node plugins/agy-memory-layer/scripts/switch-persona.js --list

# Switch to Linus (Stern Master) preset
node plugins/agy-memory-layer/scripts/switch-persona.js linus

# Switch to Memo (Default Letta Code) preset
node plugins/agy-memory-layer/scripts/switch-persona.js memo
```
