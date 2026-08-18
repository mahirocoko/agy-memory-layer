# AGENTS.md — Agent & Pair Programmer Guide for `agy-memory-layer`

Welcome to **`agy-memory-layer`** (`learn-letta-code`). This document defines the engineering standards, architecture rules, and non-negotiable conventions for all agents and pair programmers working in this repository.

---

## 🏛️ System Overview & Core Architecture

`agy-memory-layer` is an installable, self-contained **Antigravity CLI Plugin** that transforms Antigravity into a stateful, long-term learning pair programmer backed by Git-versioned MemFS (`~/.gemini/memory/`).

```text
Host Workspace (learn-letta-code)
  │
  ├── plugins/agy-memory-layer/ (Plugin Bundle symlinked to ~/.gemini/antigravity-cli/plugins/)
  │   ├── plugin.json & hooks.json
  │   ├── agents/                  (6 First-Class Subagent Manifests)
  │   ├── prompts/                 (Prompt Warehouse: system, persona, subagents)
  │   ├── rules/AGENTS.md          (In-Context Autonomous Directives)
  │   ├── skills/*/SKILL.md        (10 Slash Command Skills)
  │   └── scripts/*.js, *.sh       (Lifecycle Hooks, Daemon & Palace Generator)
  │
  └── ~/.gemini/memory/            (Independent Git MemFS Repository)
      ├── global/                  (human.md, persona.md)
      └── projects/<slug>/         (project.md, rules.md, learnings/)
```

---

## 📜 Non-Negotiable Engineering Rules

### 1. External Memory Isolation
- Memory storage is **strictly external** in `~/.gemini/memory/` and must never pollute workspace git repositories.
- Never write memory notes directly to `.git/` or repository root unless explicitly instructed by the user.

### 2. TypeScript & Type Declarations
- **Strict `type` Aliases**: ทุกครั้งที่เขียน TypeScript ต้องใช้ `type` alias เท่านั้น **ห้ามใช้ `interface` เด็ดขาด** (`export type Foo = { ... }`).
- Zero `any` where possible; use explicit discriminated unions and robust return types.

### 3. Review-First Commit Governance (No Auto-Commit)
- **ห้าม commit อัตโนมัติเด็ดขาด**: Always present test verification results and file diffs (`git status --short`, `git diff --stat`) for user review before committing.
- Only create commits when explicitly commanded by the user (or via `/git-commit`).

### 4. Remote Git Push Safety
- **ห้าม `git push` ขึ้น remote repository เด็ดขาด**: Never run `git push` unless the user explicitly orders a push in their prompt.

### 5. Dependency Management
- Always use the exact version flag (`-E`) when installing packages: `npm i -E <package>`.

### 6. Version Bump & Manifest Sync
- Whenever code is updated or a new release is prepared, bump the version simultaneously across all manifest surfaces:
  - `package.json`
  - `plugins/agy-memory-layer/plugin.json`
  - `plugins/agy-memory-layer/scripts/palace-generator.js`
  - `CONTRACT.md`
  - `~/.gemini/memory/projects/<slug>/project.md`

### 7. Code Search & CocoIndex Governance
- **Strict Preflight**: Never chain `ccc init && ccc index` without filename-only preflight.
- **Portable Enforcement Boundary**: `.cocoindex_code/settings.yml` acts as the portable boundary for sensitive credential exclusion and noise filtering.
- **Search Tooling Priority**: Prefer CocoIndex / `ccc search` for semantic exploration; use `grep_search` / `rg` for exact tokens, syntax, and literal strings.

---

## 🛠️ Verification & Test Suite

Always run the full test suite before concluding changes:

```bash
npm test
```

Expected output: **9/9 test suites passing (100% Green)**.
- PreInvocation hook schema validation
- Stop hook auto-commit and step-count trigger
- Memory Palace HTML generator with cache-busting headers
- Hybrid Semantic Recall engine (BM25 + Cosine Similarity)
- Auto-Dream background daemon & 20-step count triggers
- Agent launcher subagent manifest resolution

---

## 📂 Documentation Family Map

Detailed operational documentation is split into modular files under [`docs/`](file:///Users/mahiro/Git/me/sandbox/learn-letta-code/docs/):

- [`docs/onboarding.md`](file:///Users/mahiro/Git/me/sandbox/learn-letta-code/docs/onboarding.md) — Day 1 setup, installation lifecycle, and environment verification.
- [`docs/project-overview.md`](file:///Users/mahiro/Git/me/sandbox/learn-letta-code/docs/project-overview.md) — Deep architectural overview and MemFS design.
- [`docs/development-commands.md`](file:///Users/mahiro/Git/me/sandbox/learn-letta-code/docs/development-commands.md) — Script runners, testing, and daemon commands.
- [`docs/file-organization.md`](file:///Users/mahiro/Git/me/sandbox/learn-letta-code/docs/file-organization.md) — Directory layout and responsibility matrix.
- [`docs/best-practices.md`](file:///Users/mahiro/Git/me/sandbox/learn-letta-code/docs/best-practices.md) — Coding conventions, non-blocking hooks, and memory hygiene.
- [`docs/commit-guide.md`](file:///Users/mahiro/Git/me/sandbox/learn-letta-code/docs/commit-guide.md) — Review workflow, commit formatting, and release hygiene.
- [`docs/code-style/typescript.md`](file:///Users/mahiro/Git/me/sandbox/learn-letta-code/docs/code-style/typescript.md) — Strict `type` alias conventions and error boundaries.
- [`docs/patterns/services-pattern.md`](file:///Users/mahiro/Git/me/sandbox/learn-letta-code/docs/patterns/services-pattern.md) — Hook, daemon, and subagent launcher service patterns.
