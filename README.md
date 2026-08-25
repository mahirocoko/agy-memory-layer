# 🧠 agy-memory-layer

[![Coverage](https://img.shields.io/badge/Coverage-80.68%25-green.svg)](./CONTRACT.md)
[![Integration](https://img.shields.io/badge/Integration-11%2F11%20Passed%20(100%25)-success.svg)](./TEST_REPORT.md)
[![Node.js](https://img.shields.io/badge/Node.js-v22%2B-339933.svg?logo=node.js)](https://nodejs.org)
[![Antigravity CLI](https://img.shields.io/badge/Antigravity-1.1%2B-blue.svg)](https://github.com/google/antigravity)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Evidence-Controlled Agy Delegation, Committed Git-Backed Memory, and Scoped Correction Recall for Antigravity CLI (`agy`)**
> *Inspired by the dual-memory architecture of [Letta Code](https://github.com/letta-ai/letta-code).*

---

## 🤖 Seven Declarative Subagent Roles

`agy-memory-layer` ships seven Agy role manifests. They describe intended model and tool capabilities; this repository does not itself prove host-level process or tool confinement. See [`docs/letta-parity.md`](./docs/letta-parity.md) for the source-backed parity boundary.

| Subagent & Manifest | Role & Responsibilities | Model | Declared Capability Intent |
| :--- | :--- | :---: | :---: |
| **`evidence_reviewer_agent`**<br/>↳ [`evidence_reviewer.md`](./plugins/agy-memory-layer/prompts/subagents/evidence_reviewer.md) | **Fresh Evidence Falsification Reviewer**<br/>Independently tries to disprove consequential claims with scoped deterministic evidence. | `flash` | `Read-only` |
| **`dream_agent`**<br/>↳ [`dream_subagent.md`](./plugins/agy-memory-layer/prompts/subagents/dream_subagent.md) | **Dream Reflection Subagent**<br/>Analyzes transcripts, captures user preferences (*The Annoyance Rule*), and updates MemFS. | `inherit` | `Write` (MemFS) |
| **`recall_agent`**<br/>↳ [`recall_subagent.md`](./plugins/agy-memory-layer/prompts/subagents/recall_subagent.md) | **Episodic Recall Specialist**<br/>Searches available Antigravity transcripts via hybrid local similarity. | `flash` | `Read-only` |
| **`onboarding_agent`**<br/>↳ [`onboarding.md`](./plugins/agy-memory-layer/prompts/subagents/onboarding.md) | **Codebase Onboarding Specialist**<br/>Explores repositories on Day 1 to bootstrap `project.md` and `rules.md`. | `flash` | `Write` (MemFS) |
| **`memory_agent`**<br/>↳ [`remember.md`](./plugins/agy-memory-layer/prompts/subagents/remember.md) | **MemFS Memory Specialist**<br/>Proactively updates, organizes, and prunes core memory blocks. | `inherit` | `Write` (MemFS) |
| **`history_analyzer_agent`**<br/>↳ [`recall_subagent_local.md`](./plugins/agy-memory-layer/prompts/subagents/recall_subagent_local.md) | **Deep History Analyzer**<br/>Investigates multi-step debugging traces across local conversation transcripts. | `flash` | `Read-only` |
| **`skill_creator_agent`**<br/>↳ [`skill_creator.md`](./plugins/agy-memory-layer/prompts/subagents/skill_creator.md) | **Skill Creator Specialist**<br/>Designs, authors, tests, and validates new Antigravity skills. | `pro` | `Write` |

---

## 🧭 Evidence Controller & Scoped Correction Recall

- **Vector Semantic Search**: Subword n-gram vector embeddings + BM25 keyword matching with cosine similarity scoring.
- **Evidence Controller**: Requires Agy to separate Observed/Inferred/Unverified claims, choose direct or native-subagent execution, scope every PASS, stop before ambiguous provider retries, and preserve Mahiro-owned gates. Native child invocation remains model-guided rather than host-enforced.
- **Archived Dream Evidence**: `dream-daemon.ts` uses local Agy workspace history, fails closed on unknown ownership, and archives only explicit actionable correction evidence. It never activates the protected working hypothesis and is not launched by Stop.

---

## ✨ Features

- 🧭 **Agy Evidence Controller (`/evidence-controller`)**: Applies a fixed source-of-truth/hypothesis/check/closeout loop with model-guided `DIRECT`, `ONE_LANE`, `WRITER_REVIEWER`, or `PARALLEL_READONLY` routing.
- 👤 **Committed In-Context Memory**: Injects committed `HEAD` versions of compact global/project blocks plus at most one canonical protected working hypothesis before every invocation; uncommitted, archived, malformed, conflicting, and uncurated content is never activated.
- 📦 **Git-Backed MemFS (`~/.gemini/memory/`)**: Decoupled from project source code; tracks all knowledge snapshots in an independent Git repository.
- ⚡ **Zero-Friction Lifecycle Hooks**:
  - `PreInvocation`: Reads committed Git memory into `ephemeralMessage` and discloses dirty/conflict state separately.
  - `Stop`: Reports MemFS status without staging, committing, deleting locks, or launching background work.
- 🧠 **Hybrid Semantic Recall (`/recall`)**: Subword n-gram vector embeddings + BM25 keyword fusion across available Antigravity conversation transcripts.
- 🌙 **Dreaming (`/dream` & `dream-daemon.ts`)**: Explicit reflection guidance plus an optional deterministic correction-archive utility; isolated model-backed reflection remains deferred.
- 🏛️ **Memory Palace (`/palace`)**: Interactive visual dashboard in your browser to inspect memory graphs, synapses, and Git commit timelines with anti-cache headers.
- 🩺 **Memory Health Auditor (`/doctor`)**: Audits memory consistency and flags drift between memory rules and actual codebase state.
- 🔌 **Plugin Lifecycle**: Installs via symlink and is toggleable with `agy plugin enable/disable`; normal uninstall preserves MemFS, while purge is explicitly destructive.

---

## 🚀 Quick Start

### 1. One-Line Installation (No Manual Clone Required)

Install directly to your machine with a single terminal command:

```bash
curl -fsSL https://raw.githubusercontent.com/mahirocoko/agy-memory-layer/main/install.sh | bash
```

### 2. Manual Installation from Source

If you prefer to clone and develop locally:

```bash
git clone https://github.com/mahirocoko/agy-memory-layer.git
cd agy-memory-layer
./install.sh
```

The installer will:
1. Initialize the Git-backed memory repository at `~/.gemini/memory/`.
2. Seed default template files (`human.md`, `persona.md`).
3. Symlink the plugin bundle to `~/.gemini/antigravity-cli/plugins/agy-memory-layer`.
4. Validate lifecycle hook scripts.

> 📖 **Want to know exactly what happens during installation?**  
> Check out the in-depth [INSTALLATION_DETAILS.md](./INSTALLATION_DETAILS.md) guide.

---

## 🛠️ Slash Commands & Skills

Once installed, the following commands are available directly inside Antigravity CLI:

| Command | Description | Example Usage |
| :--- | :--- | :--- |
| **`/evidence-controller`** | Evidence-scoped execution, model-guided direct/delegated routing, fresh review, provider stop gates, and human-owned acceptance. | `/evidence-controller` or `/evidence-controller bootstrap` |
| **`/init`** | **Day 1 Onboarding**: Scans codebase architecture, entry points, linters, and scripts to seed `project.md` and `rules.md` immediately. | `/init` or `/init --force` |
| **`/memory`** | Inspect active memory blocks and recent Git snapshot history. | `/memory` |
| **`/memory search`** | Fast ranked search across historical `learnings/` logs, project rules, and global memory. | `/memory search docker` |
| **`/recall`** | Hybrid search across available Antigravity conversation sessions, separate from editable Markdown memory. | `/recall palace token`, `/recall list`, or `/recall search "setup" --semantic` |
| **`/remember`** | Record a preference, style guideline, or project rule into MemFS. | `/remember Always use exact flag (-E) when installing packages` |
| **`/persona`** | Switch or inspect the active personality preset (`memo`, `linus`, `tutor`, `kawaii`, `architect`, `blank`). | `/persona linus` or `/persona list` |
| **`/dream`** | Explicit reflection workflow; the deterministic daemon is a separate manual/optional-cron note generator. | `/dream` or `node --experimental-strip-types scripts/dream-daemon.ts --run-now` |
| **`/doctor`** | Check memory health and detect rule contradictions with codebase. | `/doctor` |
| **`/palace`** | Generate and open the interactive Memory Palace web dashboard. | `/palace` or `/palace --summary` |
| **`/sync-letta`** | Explicit, one-way import of selected Letta Markdown into contained MemFS targets. | `/sync-letta` |
| **`/sync`** | Sync MemFS with a remote private Git repository across multiple development machines. | `/sync setup <repo-url>` or `/sync push` |
| **`/update`** | Refresh permissions, active links, and hooks from the current source; it does not download a newer release. | `/update` |

---

## 📁 Memory Storage Architecture

Memory files are stored outside the active workspace under `~/.gemini/memory/`:

```text
~/.gemini/memory/                # Standalone Git Repository
├── .git/                        # Full commit history & snapshots
├── global/
│   ├── human.md                 # User profile, coding habits, quirks
│   └── persona.md               # Agent personality & core instructions
└── projects/
    └── <project-slug>/          # Project-specific memory (auto-resolved from workspace)
        ├── project.md           # Architecture decisions & domain context
        ├── rules.md             # Project-specific coding rules
        └── learnings/
            └── working-hypothesis.md # Optional protected active hypothesis
└── archives/                    # Recall-only Markdown; never prompt-injected
```

---

## 🏛️ Memory Palace Web Visualizer

Run `/palace` or invoke the script directly to open the Memory Palace in your browser:

```bash
./plugins/agy-memory-layer/scripts/palace-server.sh --open
```

It renders an interactive dashboard showing:
- 🌐 Global memory blocks (`human.md`, `persona.md`)
- 📁 Project-scoped memory blocks & learnings
- 📜 Git commit timeline of all memory snapshots

---

## 📦 Memory Backup & Migration Tool (`tools/memory-backup.ts`)

Export, verify, and restore MemFS memory blocks across machines into a single standalone bundle with **SHA-256 cryptographic integrity verification**:

```bash
# 1. Export memory blocks to bundle file
node --experimental-strip-types tools/memory-backup.ts export -o ./memory-backup.json

# 2. Verify bundle integrity & tamper detection
node --experimental-strip-types tools/memory-backup.ts verify -i ./memory-backup.json

# 3. Import & restore memory blocks with contained writes and a targeted Git commit
node --experimental-strip-types tools/memory-backup.ts import -i ./memory-backup.json
```

**Key Capabilities:**
- 🛡️ **SHA-256 Verification**: Computes per-file checksums and an overall payload signature; detects and rejects corrupted/tampered bundles.
- 🎯 **Selective Export**: Filter by specific project slugs via `--project <slug>`.
- 🧪 **Dry-Run Mode**: Test and preview restoration with `--dry-run` without writing to disk.
- 🔒 **Project Rule Adherence**: Implemented strictly with TypeScript `type` aliases (0% `interface`).

---

## ⚙️ Plugin Management

### Refreshing the Current Source Installation
```bash
# Refresh permissions, links, and hooks after updating the source checkout
./plugins/agy-memory-layer/scripts/update.sh
```

`update.sh` does not fetch a release. Update a local checkout with Git, or rerun the root installer for a remote cached installation first.

### Temporarily Enable / Disable
```bash
# Disable plugin (hooks & skills stay inactive, data is preserved)
agy plugin disable agy-memory-layer

# Re-enable plugin
agy plugin enable agy-memory-layer
```

### Uninstallation
```bash
# Option 1: Safe uninstall (removes plugin, keeps Git memory repo intact)
./plugins/agy-memory-layer/scripts/uninstall.sh

# Option 2: Current destructive purge interface (permanently deletes ~/.gemini/memory/)
./plugins/agy-memory-layer/scripts/uninstall.sh --purge --confirm-purge
```

Purge is not part of normal uninstall. It requires the second confirmation flag, refuses a symlinked or unproven memory root, and is covered only in a disposable HOME fixture. Install, refresh, and uninstall also refuse registration symlinks whose resolved manifest is not `agy-memory-layer`; normal uninstall removes both plugin and config registration links while preserving MemFS.

---

## 🧪 Testing & Code Coverage

`agy-memory-layer` comes with a comprehensive multi-tier automated test suite verifying lifecycle hooks, memory isolation, rollback integrity, plugin schema validation, and Day 1 onboarding.

The generated report covers 11 integration scenarios. The full Node runner adds
24 focused unit cases, for 25/25 total tests in the current candidate.

### Running Tests Locally

```bash
# Run 11 integration scenarios plus current focused regressions
pnpm test

# Run test suite with V8 code coverage report
pnpm test:coverage
```

### 📈 Coverage Evidence

| Metric | v1.14.0 release |
| :--- | ---: |
| Lines | **80.68%** |
| Branches | **62.15%** |
| Functions | **83.03%** |

This is the aggregate Node/V8 snapshot for the released `v1.14.0` source.
Run `pnpm test:coverage` after source changes and update this snapshot in the
same release commit; per-file percentages remain in command output rather than
being copied into this README.

> 📋 **Detailed integration evidence**: See [TEST_REPORT.md](./TEST_REPORT.md) for the latest isolated scenario results and measured timings.

> 🧪 **Real host evidence**: See [Live Antigravity Host E2E — 2026-08-20](./docs/agy-host-e2e-2026-08-20.md) for interactive AGY injection, `/memory`, `/remember`, `/init`, restart persistence, Stop, and cleanup proof.

> ✅ **Latest release**: [`v1.14.0`](./docs/releases/v1.14.0.md) records the Evidence Controller, multi-scenario host evidence, and approved working-hypothesis migration. [`v1.13.0`](./docs/releases/v1.13.0.md) remains the prior scoped-health release.

---

## 📄 License & Acknowledgements

- **License**: MIT
- **Inspiration**: [Letta Code](https://github.com/letta-ai/letta-code) by the Letta AI team.
