# AGENTS.md — Agent & Pair Programmer Guide for `agy-memory-layer`

Welcome to **`agy-memory-layer`** (`learn-letta-code`). This document defines the engineering standards, architecture rules, and non-negotiable conventions for all agents and pair programmers working in this repository.

**Latest published release:** `v1.19.0`

**Current development candidate:** `v1.20.0` (unreleased; interactive and human-supervised)

---

## 🏛️ System Overview & Core Architecture

`agy-memory-layer` is an installable, self-contained **Antigravity CLI Plugin** that transforms Antigravity into a stateful, long-term learning pair programmer backed by Git-versioned MemFS (`~/.gemini/memory/`).

```text
Host Workspace (learn-letta-code)
  │
  ├── plugins/agy-memory-layer/ (Plugin Bundle symlinked to ~/.gemini/antigravity-cli/plugins/)
  │   ├── plugin.json & hooks.json
  │   ├── agents/                  (9 declarative subagent role manifests)
  │   ├── prompts/                 (Prompt Warehouse: system, persona, subagents)
  │   ├── rules/AGENTS.md          (In-Context Autonomous Directives)
  │   ├── skills/*/SKILL.md        (14 Slash Command Skills)
  │   └── scripts/*.ts, *.sh       (Lifecycle Hooks, Daemon & Palace Generator)
  │
  └── ~/.gemini/memory/            (Independent Git MemFS Repository)
      ├── system/                  (Focused always-active global owners)
      ├── reference/               (On-demand global evidence)
      ├── projects/<slug>/         (system/ + reference/)
      └── archives/                (Inert history and exact provenance)
```

---

## 📜 Non-Negotiable Engineering Rules

### 1. External Memory Isolation
- Memory storage is **strictly external** in `~/.gemini/memory/` and must never pollute workspace git repositories.
- Never write memory notes directly to `.git/` or repository root unless explicitly instructed by the user.

### 2. TypeScript & Type Declarations
- **Strict `type` Aliases**: ทุกครั้งที่เขียน TypeScript ต้องใช้ `type` alias เท่านั้น **ห้ามใช้ `interface` เด็ดขาด** (`export type Foo = { ... }`).
  Check: no-interface scope=**/*.ts,**/*.tsx
- Zero `any` where possible; use explicit discriminated unions and robust return types.

### 3. Review-First Commit Governance (No Auto-Commit)
- **ห้าม commit อัตโนมัติเด็ดขาด**: Always present test verification results and file diffs (`git status --short`, `git diff --stat`) for user review before committing.
- Only create commits when explicitly commanded by the user (or via `/git-commit`).

### 4. Remote Git Push Safety
- **ห้าม `git push` ขึ้น remote repository เด็ดขาด**: Never run `git push` unless the user explicitly orders a push in their prompt.

### 5. Dependency Management
- Use the repository's pinned pnpm toolchain and exact versions: `pnpm add -E <package>`.

### 6. Version Bump & Manifest Sync
- `package.json` owns candidate version intent. `plugins/agy-memory-layer/plugin.json` mirrors it, and `palace-generator.ts` dynamically reads `plugin.json` at runtime (not a static version-bump surface).
- Whenever code is updated or a new release is prepared, sync version manifests across:
  - `package.json`
  - `plugins/agy-memory-layer/plugin.json`
  - `CONTRACT.md`
- User-owned MemFS is not a release metadata surface and must not be edited for a package version bump.

### 7. Code Search & CocoIndex Governance
- **Strict Preflight**: Never chain `ccc init && ccc index` without filename-only preflight.
- **Portable Enforcement Boundary**: `.cocoindex_code/settings.yml` acts as the portable boundary for sensitive credential exclusion and noise filtering.
- **Search Tooling Priority**: Prefer CocoIndex / `ccc search` for semantic exploration; use `grep_search` / `rg` for exact tokens, syntax, and literal strings.

### 8. Candidate Control Boundaries
- **Atomic confirmation requests**: PreToolUse denies ambiguous bundles, malformed inputs, destructive actions, and protected targets, while one recognized scoped mutation receives `force_ask`. This classifier does not authenticate authorization or grants and does not universally cover shell semantics.
- **Material claims**: Bind consequential claims to current owner and consumer bytes, explicit counterexample probes/outcomes, and fresh reviewer metadata. Packet verification is structural/current-byte evidence, not semantic proof; reviewer identity remains `not-authenticated`.
- **Continuity**: Bounded re-grounding and fresh-conversation rotation are model-guided policy only. There is no compaction interceptor, mission supervisor, deterministic rotation, or automatic continuation.
- **Supervision**: The `v1.20.0` candidate requires interactive pane supervision because host lifecycle status may be stale while permission UI remains pending, and a reviewer model may not observe that UI.

---

## 🛠️ Verification & Test Suite

Always run the full test suite before concluding changes:

```bash
pnpm test
```

The Phase 3 Direct CLI verifier lane retains **30/30 focused Phase 3**
and **108/108 aggregate host-evidence** tests. Final `v1.20.0` candidate verification
on 2026-09-13 passed 206/206 Node tests, 11/11 generated integration scenarios,
`pnpm check`, plugin validation (14 skills, 9 agents, 3 hooks, zero errors), and
coverage at 86.71% lines / 74.97% branches / 90.66% functions. The latest
published release remains `v1.19.0`; do not infer unsupervised readiness from
candidate evidence alone.
- PreInvocation hook schema validation
- Committed-HEAD projection and non-mutating Stop status
- Contained paths and targeted memory commits
- Memory Palace HTML generator with cache-busting headers
- Hybrid Semantic Recall engine (BM25 + Cosine Similarity)
- Explicit/manual Dream daemon scanner and 20-step count logic
- Agent launcher subagent manifest resolution
- Test-only execution-continuity Stage 0 fixtures plus the Stage 1 disposable runner, scorer, and
  stale-state regressions
- Current-source offline host-evidence contract, receipt lifecycle, immutable system-temp store,
  fake transport, independent replay, derivation, sealing, and tamper regressions

Topology or schema changes that affect Memory Palace require consumer-level
acceptance, not only source, projection, health, or file-generation checks.
Before calling them complete, verify every supported layout with generated HTML
and a real browser: layered child paths and counts, per-node content/metadata/Git
detail, legacy flat fallback, mixed-layout fail-closed behavior, current-project
scope, and click selection. A test that only proves the HTML file exists is not
Palace topology coverage.

When evidence points to harness, retrieval, projection, host transport, or
scoring weakness, fix and verify that owner first. Do not default to curating
user memory. Propose memory mutation only after isolating a defect in canonical
memory content and obtaining approval.

Do not infer real Agy memory understanding from projection, hook, health,
Palace, or browser checks. Before claiming a layered-memory change works
end-to-end, run a fresh Agy host semantic matrix without repository/file tools:
attribute one fact to every active owner, prove only the current project's
system owners are active, and prove references expose path/description but not
body. Then run one bounded on-demand Memory search for a reference-only fact,
verify its exact source, and confirm no memory or source mutation. Keep legacy,
mixed-layout, and write behavior scoped separately unless real host evidence
also covers them.

---

## 📂 Documentation Family Map

Detailed operational documentation is split into modular files under [`docs/`](docs/):

- [`docs/onboarding.md`](docs/onboarding.md) — Day 1 setup, installation lifecycle, and environment verification.
- [`docs/project-overview.md`](docs/project-overview.md) — Deep architectural overview and MemFS design.
- [`docs/letta-parity.md`](docs/letta-parity.md) — Canonical Letta behavior → Agy adaptation → implementation status matrix.
- [`docs/execution-continuity-pilot.md`](docs/execution-continuity-pilot.md) — Stage 0 fixture-preflight and audited Stage 1 results; both candidate modes are disqualified and production continuity remains unimplemented.
- [`docs/execution-continuity-stage1-evidence-2026-09-11.md`](docs/execution-continuity-stage1-evidence-2026-09-11.md) — Exact 15-run receipts, false-PASS findings, cleanup, and the no-advance decision.
- [`docs/host-evidence-phase3.md`](docs/host-evidence-phase3.md) — Current-source evidence-only verifier for terminal Direct CLI callback receipts, Phase 2 sealing, repository/MemFS content invariance, retained checkpoints, and non-claims; the installed Direct CLI workflow owns Agy/Herdr lifecycle execution.
- [`docs/agy-main-phase4a-external-product-attribution-2026-09-13.md`](docs/agy-main-phase4a-external-product-attribution-2026-09-13.md) — Historical external-product attribution baseline; not the current candidate owner.
- [`docs/agy-main-phase4b-readiness-2026-09-13.md`](docs/agy-main-phase4b-readiness-2026-09-13.md) — Canonical `v1.20.0` local readiness report and interactive/human-supervised boundary; links the retained canary evidence.
- [`docs/development-commands.md`](docs/development-commands.md) — Script runners, testing, and daemon commands.
- [`docs/file-organization.md`](docs/file-organization.md) — Directory layout and responsibility matrix.
- [`docs/best-practices.md`](docs/best-practices.md) — Coding conventions, non-blocking hooks, and memory hygiene.
- [`docs/commit-guide.md`](docs/commit-guide.md) — Review workflow, commit formatting, and release hygiene.
- [`docs/code-style/typescript.md`](docs/code-style/typescript.md) — Strict `type` alias conventions and error boundaries.
- [`docs/patterns/services-pattern.md`](docs/patterns/services-pattern.md) — Hook, daemon, and subagent launcher service patterns.
