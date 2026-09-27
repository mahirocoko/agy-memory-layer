# Development & Operational Commands — `agy-memory-layer`

This reference documents all testing, verification, script runners, and daemon commands available in this codebase.

**Latest published release:** `v1.23.0` (interactive and human-supervised)

**Current development state:** matches `v1.23.0`; no newer candidate is declared

---

## 🧪 Testing & Quality Assurance

Run the primary Node.js test runner suite:

```bash
# Run integration scenarios plus focused unit cases
pnpm test

# Run the current Phase 3 first-turn adapter regressions only (fixture mode; no host effects)
pnpm test:phase3

# Run the atomic PreToolUse confirmation-request regressions only
node --experimental-strip-types --test --test-concurrency=1 tests/tool-guard.test.ts

# Run the material-claim packet verifier regressions only
node --experimental-strip-types --test --test-concurrency=1 tests/material-claim-review.test.ts

# Run the deterministic current documentation/version/script contracts only
node --experimental-strip-types --test --test-concurrency=1 tests/unit-coverage.test.ts
```

Both focused release test files are included in `pnpm test` and
`pnpm test:coverage`. The tool guard classifies confirmation requests; it does
not authenticate authorization or grants and does not universally cover shell
semantics. The material-claim verifier binds current owner/consumer bytes,
counterexamples/outcomes, and fresh reviewer metadata, but is not semantic
proof and always reports identity as `not-authenticated`.

The focused Phase 3 command exercises only the Direct CLI callback evidence
adapter (`tools/host-evidence-direct-cli.ts`) against retained job bundles and
counterexamples; it launches no Herdr, Agy, provider, browser, or network
action. Runtime lifecycle execution remains external to this repository. See
[`host-evidence-phase3.md`](./host-evidence-phase3.md).

## Material-claim retained canary verification

The retained negative-control packet is expected to exit `1` because its seeded
release-state contradiction is `fail`; the host-prompt claim remains `blocked`
because the reviewer model did not observe the permission UI.

```bash
(
  cd docs/evidence/agy-main-phase4b-canary-2026-09-13
  node --experimental-strip-types ../../../plugins/agy-memory-layer/scripts/material-claim-review.ts verify --subject subject.json --review review.json
)
```

An accepted packet shape and current bytes do not prove semantic correctness.
See the [retained readiness report](./agy-main-phase4b-readiness-2026-09-13.md)
and [retained evidence index](./evidence/agy-main-phase4b-canary-2026-09-13/README.md).

---

## 🌙 Deterministic Dream Note Utility

`dream-daemon.ts` maps transcripts through local Agy workspace history and writes deterministic recall-only correction evidence only when explicit durable-memory intent contains an actionable rule or fact. Unknown ownership, vague intent, and no-signal sessions skip. It never activates the protected working hypothesis, remains separate from Stop, and does not provide Letta's model-backed isolated reflection worktree.

```bash
# Check status of pending undreamed sessions for current project
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --status

# Check status of pending undreamed sessions across all projects (grouped summary)
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --status --all-projects

# Check status of pending undreamed sessions for a specific target project
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --status --project <slug>

# Process pending sessions for current project; only explicit durable intent creates archive evidence
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now

# Process pending sessions across all initialized projects
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now --all-projects

# Process pending sessions for a specific target project
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now --project <slug>

# Force immediate synthesis regardless of session age
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now --force

# Run the step-count check explicitly (Stop does not invoke it)
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --auto-check

# Install background cron job on macOS (runs every 2 hours)
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --install-cron

# Uninstall background cron job
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --uninstall-cron
```

Cron installation is an explicit user choice. Treat it as an Agy utility, not as proven Letta reflection parity. `--install-cron` and `--uninstall-cron` schedule regex Dream only. Combining either with `--llm` exits before crontab is read. Regex uninstall does not remove an LLM cron line.

## Opt-in LLM reflection

Regex Dream remains the default. `reflection.enabled` gates automatic or
scheduled LLM only and defaults to `false`. This tree does not install an LLM
schedule, including when the flag is true. Explicit `--run-now --llm` is a
manual operator override and is not blocked by that flag.

```bash
# Status labels reflection.enabled as automatic/scheduled state.
# Schedule installation is reported as not inspected; status does not read crontab.
# Manual --run-now --llm stays an operator override.
# It does not print prompts, transcript bodies, or reference bodies.
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --status

# One conversation. Writes explicit pending proposals and does not commit MemFS.
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now --llm

# Bypass only the next-eligibility clock. The 50-step gate, schema, path, snapshot, approval, and lock guards remain.
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now --llm --force

# Review the proposal with the existing approval owner.
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-approval.ts list
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-approval.ts approve <proposalId>
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-approval.ts reject <proposalId>
```

Malformed, unknown, or out-of-range reflection fields are rejected. LLM
reflection does not run on that file, and regex Dream does not rewrite the
invalid reflection object. Manual and automatic LLM eligibility both require
50 new steps. Backoff starts only after one conversation is selected. Each later failed class for
that conversation waits 15, 30, 60, 120, 240, then 360 minutes. A skipped
backoff run does not call the model, create proposals, advance the reflection
cursor, or add another failure. A successful no-op or created proposal resets
that failure record. Rejection does not requeue the reviewed slice. `--force`
bypasses only the next-eligibility time. It does not lower the 50-step gate.

The requested primary model is `claude-opus-4-6-thinking`. `fallbackModel`
stays `null`. A fake transport is the test boundary. A live adapter can spawn
`agy --print`, but a JSON response does not prove exclusive model routing,
host no-tools execution, or an active schedule. The private temp directory is
removed after the attempt and does not prove host isolation. Do not substitute
a Gemini 3.x model. `gemini-4.8-high` is not an earned fallback.

For current Agy 1.2.12 JSON-schema runs, the accepted generation envelope must
contain the ordinary status, usage, and display `response` fields plus
`structured_output` and `json_schema`. The echoed schema must be semantically
identical to the requested schema. Dream treats `structured_output` as the only
planner result; the display response is required but non-authoritative. Missing,
extra, mismatched, denied-action, duplicate-key, or malformed fields fail
closed over the raw envelope before a proposal or cursor update.

The final bounded Agy 1.2.12 proof used one exact-model generation call and
passed through this envelope boundary: one explicit proposal was created and
the disposable reflection cursor advanced through step 50. The proposal was
not approved or committed, live MemFS/state and the source worktree stayed
invariant, `reflection.enabled` remained false, and no schedule was installed.
This does not prove exclusive provider routing or host no-tools isolation.
Mahiro accepted this explicit manual path only; automatic reflection and a
persistent LLM schedule remain disabled and are not approved.

One reflection reservation may exist under the external state root. A live,
dead, or unreadable reservation blocks the provider call and does not change
backoff or the cursor. Nothing in that path deletes the file automatically.
Inspect it, then reclaim a dead owner only with the matching token:

```bash
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --inspect-reflection-reservation
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --reclaim-reflection-reservation --reservation-token=<token>
```

A dead reservation is not crash-safe replay. If the process died after creating
proposals and before advancing the cursor, reclaim does not repair that pair.
Inspect pending proposals before reclaiming.

LLM cron source is present and unactivated. Preview does not read or write
crontab. Status does not inspect crontab, so installation state is
`not-inspected` and stays separate from `reflection.enabled`. Installation
requires `reflection.enabled=true` and the exact confirmation
`install-llm-reflection-schedule`. A failed crontab read refuses installation
and writes nothing. The LLM line is separate from regex cron, shell-quotes the
node and script paths, and passes `--all-projects` because a cron process has
no workspace cwd. No schedule is installed in this tree:

```bash
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --preview-llm-cron
# Do not run until Mahiro activates scheduling:
# node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --install-llm-cron --confirm-llm-cron=install-llm-reflection-schedule
```

The preview line runs `--run-scheduled-llm --all-projects`, which refuses while
`reflection.enabled` is false. That is distinct from manual `--run-now --llm`.
A successful install says the entry is installed and eligible at the next
scheduled time while enabled. Phase 4 source and disposable regressions are
independently verified. Regex Dream stays the default. There is no provider
proof, no active schedule, and crash-after-proposal is not replay. Host
isolation is unverified. Mixed old and new Dream writer processes are
unsupported during the protocol upgrade.

Recovery: fix invalid `dream-state.json` without dropping regex cursors; wait
for `nextEligibleAt` or pass `--force`; use `memory-approval.ts reject` to drop
a proposal without a MemFS commit; use `memory-curation.ts` for delete or
paraphrase. Dream records delete suggestions as `CURATION_REQUIRED` and does
not delete active memory. Do not delete a reservation by hand unless inspect
shows it is dead and no writer is active.

## 🩺 Deterministic Memory Health

```bash
pnpm memory:health -- --workspace "$(pwd)"
```

Pass additional `--workspace <path>` arguments to audit multiple active scopes.
The strict command checks clean Git state, complete project scopes, the 32,000-token
projection budget, tracked transient residue, and archive/session-boilerplate injection.
Crossing that budget fails the offline gate. The token count is the aggregate
active payload before transport chunking, excluding the authority stanza,
chunk labels, active-memory header, and budget notice. PreInvocation packs that
payload into ordered steps of at most 40,000 UTF-8 bytes and puts the `/doctor`
notice only on the final step. Empty memory stays one authority-only step.

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

Switches or inspects agent personality presets through an explicit curation
proposal. Existing persona bytes are archived before an approved replacement.

```bash
# List available persona presets
node --experimental-strip-types plugins/agy-memory-layer/scripts/switch-persona.ts --list

# Switch to Linus (Stern Master) preset
node --experimental-strip-types plugins/agy-memory-layer/scripts/switch-persona.ts linus

# Switch to Memo (Default Letta Code) preset
node --experimental-strip-types plugins/agy-memory-layer/scripts/switch-persona.ts memo
```

The switch command prints a proposal ID; it does not activate the new persona
until that proposal is approved.

---

## 🧱 Layered Migration and Curation

```bash
# Inventory legacy source receipts and durable unit IDs
pnpm memory:migration units --memory "${HOME}/.gemini/memory"

# Plan only; no MemFS mutation
pnpm memory:migration plan --memory "${HOME}/.gemini/memory" --spec /tmp/migration.json

# Plan or propose a provenance-preserving routine curation
pnpm memory:curation plan --memory "${HOME}/.gemini/memory" --spec /tmp/curation.json
pnpm memory:curation propose --memory "${HOME}/.gemini/memory" --spec /tmp/curation.json
```

Live migration requires the reviewed plan hash and a separate human gate. See
[`layered-memory.md`](./layered-memory.md).

---

## 🤖 Explicit Letta Markdown Import

Inspects and imports selected Letta Markdown as on-demand reference evidence.
This is a one-way adapter, not active-memory merging, live sync, or LLM grooming.

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
