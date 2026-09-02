# 🧠 agy-memory-layer

[![Coverage](https://img.shields.io/badge/Coverage-81.23%25-green.svg)](./CONTRACT.md)
[![Integration](https://img.shields.io/badge/Integration-11%2F11%20Passed%20(100%25)-success.svg)](./TEST_REPORT.md)
[![Node.js](https://img.shields.io/badge/Node.js-v22%2B-339933.svg?logo=node.js)](https://nodejs.org)
[![Antigravity CLI](https://img.shields.io/badge/Antigravity-1.1%2B-blue.svg)](https://github.com/google/antigravity)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Evidence-Controlled Agy Delegation, Committed Git-Backed Memory, and Scoped Correction Recall for Antigravity CLI (`agy`)**
> *Inspired by the dual-memory architecture of [Letta Code](https://github.com/letta-ai/letta-code).*

> **v1.15.4 Candidate (Unreleased):** Model-guided authority boundary and
> anti-laundering stanza emitted first whenever a schema-valid PreInvocation
> hook completes, canonical authority doctrine across plugin rules, skills, and
> authority-sensitive subagent prompts,
> and explicit distinction between non-binding historical evidence and fresh
> authorization. (Development candidate; v1.15.3 remains the latest actual release).
> A serialized real-Agy authority matrix passed an 8/8 coached baseline and a
> separate 4/4 uncoached bare-turn remediation with one scored host conversation
> per scenario; see the [parity evidence](./docs/letta-parity.md#model-guided-authority-host-matrix--2026-09-02).

> **v1.15.3 (Latest Release):** focused layered memory, bounded reference indexing,
> provenance-preserving curation, a hash-confirmed legacy
> migration/rollback path. Upgrading the plugin does not automatically migrate
> an existing MemFS; migration remains an explicit reviewed operation. Memory
> Palace now renders the committed layered Human subtree as individual files.

---

## 🤖 Seven Declarative Subagent Roles

`agy-memory-layer` ships seven Agy role manifests. They describe intended model and tool capabilities; this repository does not itself prove host-level process or tool confinement. See [`docs/letta-parity.md`](./docs/letta-parity.md) for the source-backed parity boundary.

| Subagent & Manifest | Role & Responsibilities | Model | Declared Capability Intent |
| :--- | :--- | :---: | :---: |
| **`evidence_reviewer_agent`**<br/>↳ [`evidence_reviewer.md`](./plugins/agy-memory-layer/prompts/subagents/evidence_reviewer.md) | **Fresh Evidence Falsification Reviewer**<br/>Independently tries to disprove consequential claims with scoped deterministic evidence. | `flash` | `Read-only` |
| **`dream_agent`**<br/>↳ [`dream_subagent.md`](./plugins/agy-memory-layer/prompts/subagents/dream_subagent.md) | **Dream Reflection Subagent**<br/>Analyzes transcripts, captures user preferences (*The Annoyance Rule*), and updates MemFS. | `inherit` | `Write` (MemFS) |
| **`recall_agent`**<br/>↳ [`recall_subagent.md`](./plugins/agy-memory-layer/prompts/subagents/recall_subagent.md) | **Episodic Recall Specialist**<br/>Searches available Antigravity transcripts via hybrid local similarity. | `flash` | `Read-only` |
| **`onboarding_agent`**<br/>↳ [`onboarding.md`](./plugins/agy-memory-layer/prompts/subagents/onboarding.md) | **Codebase Onboarding Specialist**<br/>Explores repositories on Day 1 to bootstrap focused project-system owners. | `flash` | `Write` (MemFS) |
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
- 🔒 **Model-Guided Authority & Anti-Laundering Boundary**: Emits a bounded authority stanza first whenever the schema-valid PreInvocation hook runs to completion; a host timeout or unexpected hook-process failure can omit the entire injection. Treats summaries, recall, injected memory, and child reports as historical evidence rather than fresh authorization.
- 👤 **Focused Committed Memory**: Injects lexical global/current-project
  `system/**/*.md` bodies plus a bounded path/description reference index and at
  most one protected working hypothesis. Other projects, reference bodies,
  archives, dirty edits, malformed metadata, and mixed layouts never activate.
- 🧾 **Lossless Curation & Migration**: Explicit proposals carry base/content
  receipts; moves and demotions require exhaustive dispositions and exact source
  archives. Legacy migration is read-only until a reviewed plan hash is applied,
  and rollback adds a restoring commit instead of rewriting history.
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
2. Seed focused `system/persona.md` and `system/human/**/*.md` templates for a new MemFS.
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
| **`/init`** | **Day 1 Onboarding**: Scans architecture, entry points, linters, and scripts to seed the selected project's overview and conventions. | `/init` or `/init --force` |
| **`/memory`** | Inspect active memory blocks and recent Git snapshot history. | `/memory` |
| **`/memory search`** | Fast ranked search across active, reference, and archived Markdown. | `/memory search docker` |
| **`/recall`** | Hybrid search across available Antigravity conversation sessions, separate from editable Markdown memory. | `/recall palace token`, `/recall list`, or `/recall search "setup" --semantic` |
| **`/remember`** | Record a preference, style guideline, or project rule into MemFS. | `/remember Always use exact flag (-E) when installing packages` |
| **`/persona`** | Inspect presets or prepare an explicit, provenance-preserving persona switch. | `/persona linus` or `/persona list` |
| **`/dream`** | Explicit reflection workflow; the deterministic daemon is a separate manual/optional-cron note generator. | `/dream` or `node --experimental-strip-types scripts/dream-daemon.ts --run-now` |
| **`/doctor`** | Check memory health and detect rule contradictions with codebase. | `/doctor` |
| **`/palace`** | Generate and open the interactive Memory Palace web dashboard. | `/palace` or `/palace --summary` |
| **`/sync-letta`** | Explicit, one-way import of selected Letta Markdown as on-demand evidence. | `/sync-letta` |
| **`/sync`** | Sync MemFS with a remote private Git repository across multiple development machines. | `/sync setup <repo-url>` or `/sync push` |
| **`/update`** | Refresh permissions, active links, and hooks from the current source; it does not download a newer release. | `/update` |

---

## 📁 Memory Storage Architecture

Memory files are stored outside the active workspace under `~/.gemini/memory/`:

```text
~/.gemini/memory/                # Standalone Git Repository
├── .git/                        # Full commit history & snapshots
├── system/                      # Always-active global memory
│   ├── persona.md
│   └── human/**/*.md            # Focused identity and preference owners
├── reference/**/*.md            # Indexed on-demand global evidence
├── projects/
    └── <project-slug>/          # Project-specific memory (auto-resolved from workspace)
        ├── system/**/*.md       # Active only for the current project
        └── reference/**/*.md    # Indexed on-demand project evidence
└── archives/                    # Exact provenance/history; never prompt-injected
```

Existing four-file MemFS repositories continue in legacy fallback mode. See
[`docs/layered-memory.md`](./docs/layered-memory.md) for the human-gated migration
and rollback protocol.

---

## 🏛️ Memory Palace Web Visualizer

Run `/palace` or invoke the script directly to open the Memory Palace in your browser:

```bash
./plugins/agy-memory-layer/scripts/palace-server.sh --open
```

It renders an interactive dashboard showing:
- 🌐 Committed global Core memory, including nested `system/human/**` files in layered mode
- 📁 Current-project Core memory as individual selectable files, plus historical learnings
- 📜 Git commit timeline of all memory snapshots

The Core tree mirrors the selected committed layout: layered folders stay
nested, legacy owners stay flat, and mixed ownership fails closed instead of
showing an ambiguous dashboard.

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

The generated report covers 11 integration scenarios. The unreleased v1.15.4
candidate includes 38 focused Node cases across projection, migration, rollback,
curation, lock contention, lifecycle, engine behavior, authority boundaries,
and current contract drift.

### Running Tests Locally

```bash
# Run 11 integration scenarios plus current focused regressions
pnpm test

# Run test suite with V8 code coverage report
pnpm test:coverage
```

### 📈 Coverage Evidence

| Metric | v1.15.4 candidate |
| :--- | ---: |
| Lines | **81.23%** |
| Branches | **65.68%** |
| Functions | **85.45%** |

This is the aggregate Node/V8 snapshot for the unreleased `v1.15.4` candidate.
Run `pnpm test:coverage` after source changes and update this snapshot in the
same candidate/release change; per-file percentages remain in command output rather than
being copied into this README.

> 📋 **Detailed integration evidence**: See [TEST_REPORT.md](./TEST_REPORT.md) for the latest isolated scenario results and measured timings.

> 🧪 **Real host evidence**: See [Live Antigravity Host E2E — 2026-08-20](./docs/agy-host-e2e-2026-08-20.md) for interactive AGY injection, `/memory`, `/remember`, `/init`, restart persistence, Stop, and cleanup proof.

> ✅ **Latest release**: [`v1.15.3`](./docs/releases/v1.15.3.md) restores the committed layered Human subtree in Memory Palace and adds real Agy host acceptance for owner attribution, project routing, reference boundaries, and on-demand retrieval. [`v1.15.2`](./docs/releases/v1.15.2.md) remains the descendant-safe rollback release.

---

## 📄 License & Acknowledgements

- **License**: MIT
- **Inspiration**: [Letta Code](https://github.com/letta-ai/letta-code) by the Letta AI team.
