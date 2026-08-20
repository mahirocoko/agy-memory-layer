# Architecture Analysis: `agy-memory-layer`

**Repository:** `/Users/mahiro/Git/me/sandbox/learn-letta-code`  
**Snapshot:** current working tree on 2026-08-20; source and tests were treated as stronger evidence than prose.  
**Scope:** static architecture analysis only. The checkout already had uncommitted changes; this report does not treat them as a clean baseline.

## Executive summary

`agy-memory-layer` is not a conventional long-running application. It is an Antigravity CLI plugin bundle whose runtime is distributed across:

1. **Host integration:** `plugin.json`, `hooks.json`, `skills/*/SKILL.md`, `agents/*.json`, prompts, and `rules/AGENTS.md`.
2. **Lifecycle scripts:** shell entry points delegate to native TypeScript implementations under `plugins/agy-memory-layer/scripts/`.
3. **External state:** a separate Git repository at `~/.gemini/memory/`, plus Antigravity transcript data under `~/.gemini/antigravity-cli/brain/` and optional Letta state under `~/.letta/`.

The central runtime loop is: **Antigravity invocation -> PreInvocation memory injection -> agent turn -> Stop-hook Git snapshot -> asynchronous dream scan**. Most other capabilities are standalone TypeScript services or CLI tools that read/write the same MemFS tree rather than a shared in-process service layer.

The strongest architectural property is the explicit separation of plugin code from user memory. The most urgent current defect is that the working tree's new TypeScript Stop-hook implementation is selected by `hook-auto-commit.sh` but calls the CommonJS-only `__filename` global in ESM; the current `TEST_REPORT.md` records this exact failure, so the automatic commit lifecycle is not currently reliable.

## 1. Directory structure and ownership boundaries

### Repository map

```text
learn-letta-code/
├── AGENTS.md                         Root engineering rules and architecture guidance
├── package.json / pnpm-lock.yaml     Node/TypeScript tooling contract
├── tsconfig.json / biome.json        Type checking and formatting/linting
├── install.sh                        Distribution/local-or-curl installer
├── README.md                         Public product documentation
├── CONTRACT.md                       Formal architecture/release contract
├── INSTALLATION_DETAILS.md           Installation/lifecycle explanation
├── docs/                             Modular developer documentation
├── assets/                           Architecture diagrams
├── plugins/agy-memory-layer/         Actual Antigravity plugin bundle
├── tools/                            Standalone memory backup utility
├── tests/                            Integration harness and unit coverage
├── .agent-state/                     Ignored agent-generated state/worktrees
├── .cocoindex_code/                  Local code-index data and policy
└── .letta/                            Current untracked local Letta configuration
```

The root guide defines the intended host/plugin/external-memory split and names `plugins/agy-memory-layer/` as the bundle, with `~/.gemini/memory/` as an independent Git MemFS (`AGENTS.md:7-24`). The plugin-local rules repeat the storage boundary and memory schema (`plugins/agy-memory-layer/rules/AGENTS.md:58-78`).

### Ownership table

| Boundary | Canonical owner | Responsibility |
|---|---|---|
| Repository policy | `AGENTS.md` | Agent constraints, dependency/commit rules, test command, documentation family. |
| Plugin metadata and host hooks | `plugins/agy-memory-layer/plugin.json`, `plugins/agy-memory-layer/hooks.json` | Plugin identity/version and the two lifecycle registrations. `hooks.json:3-18` registers `PreInvocation` and `Stop`. |
| Host-discovered commands | `plugins/agy-memory-layer/skills/*/SKILL.md` | Human/agent runbooks for `/init`, `/memory`, `/recall`, `/dream`, `/persona`, `/sync`, `/sync-letta`, and related commands. These are declarative instructions, not a central TypeScript command registry. |
| Subagent declarations | `plugins/agy-memory-layer/agents/*.json` | Six model/tool permission manifests. `agent-launcher.ts` resolves them and their prompt files (`plugins/agy-memory-layer/scripts/agent-launcher.ts:35-68`). |
| Prompt assets | `plugins/agy-memory-layer/prompts/` | System, persona, human, subagent, and alert prompt material. The six manifests point into `prompts/subagents/` (for example, `agents/dream_agent.json:2-9`). |
| Behavioral directives | `plugins/agy-memory-layer/rules/AGENTS.md` | In-context autonomous memory rules, including isolation and hook guarantees. |
| Executable plugin runtime | `plugins/agy-memory-layer/scripts/` | Shell wrappers/installers and TypeScript implementations for hooks, indexing, recall, dreaming, sync, compaction, palace generation, backup-adjacent operations, and worktrees. |
| Repository utility | `tools/memory-backup.ts` | Export/verify/import of external memory bundles with SHA-256 checksums (`tools/memory-backup.ts:178-256`, `:259-375`, `:377-493`). |
| Verification | `tests/` | `run-test-suite.ts` exercises host-facing flows and writes `TEST_REPORT.md`; `unit-coverage.test.ts` imports most TypeScript services directly. |
| External runtime state | `~/.gemini/memory/`, `~/.gemini/antigravity-cli/brain/`, `~/.letta/` | Memory, transcripts, and Letta source data are outside the repository. Source constants show these paths in `hook-inject-memory.ts:122-126`, `recall-engine.ts:53-54`, `dream-daemon.ts:44-47`, and `letta-sync.ts:333-336`. |

The root `.gitignore` intentionally excludes `.agent-state/`, `node_modules/`, and `.cocoindex_code/` (`.gitignore:1-8`). It does **not** exclude `.letta/`; the current status contains an untracked `.letta/` directory. That is a current operational boundary to treat carefully, especially before broad staging.

## 2. Runtime entry points and lifecycle

### Installation

There are two installer owners:

- The distribution entry point is root `install.sh`. It detects local versus curl-based installation, creates `~/.gemini/memory/`, seeds `global/human.md` and `global/persona.md`, creates plugin/config symlinks, optionally calls `agy plugin install`, and validates both hooks (`install.sh:13-17`, `:43-76`).
- `plugins/agy-memory-layer/scripts/install.sh` is a second plugin-local installer. It initializes MemFS, optionally calls `agy plugin install`, removes a legacy `memfs` link, and links the plugin into the Antigravity plugin directory (`plugins/agy-memory-layer/scripts/install.sh:13-21`, `:55-76`).

This split is useful for local development versus distribution, but it also creates two installation behaviors that can drift. The root installer additionally creates `~/.gemini/config/plugins/...` links (`install.sh:82-95`), while the plugin-local installer does not.

### Host registration

`hooks.json` is the only explicit lifecycle registration in the bundle:

```text
PreInvocation -> ./scripts/hook-inject-memory.sh
Stop         -> ./scripts/hook-auto-commit.sh
```

Both registrations use a relative command and a timeout (`plugins/agy-memory-layer/hooks.json:3-18`). The host therefore must execute them with the plugin directory as its effective working context or otherwise resolve the relative paths.

### PreInvocation path

```text
Antigravity payload JSON
  -> hook-inject-memory.sh
  -> hook-inject-memory.ts (preferred when present)
  -> resolve workspace/project slug
  -> read ~/.gemini/memory
  -> emit { injectSteps: [{ ephemeralMessage }] }
```

The current shell wrapper explicitly prefers the untracked TypeScript implementation (`plugins/agy-memory-layer/scripts/hook-inject-memory.sh:4-11`). The TypeScript implementation:

1. Parses `workspacePaths[0]`, falling back to `process.cwd()` (`hook-inject-memory.ts:109-122`).
2. Resolves a project slug from the workspace basename, then optionally from the Git remote if a matching canonical memory directory already exists (`hook-inject-memory.ts:29-56`).
3. Reads `global/human.md`, project `project.md`, project `rules.md`, and up to two recent learning files (`hook-inject-memory.ts:122-160`).
4. Adds a budget notice above an estimated 1,400 tokens and returns an `injectSteps` envelope (`hook-inject-memory.ts:163-179`).

Notably, this hook does **not** read `global/persona.md`; persona is managed and displayed elsewhere, but it is not part of this injection implementation.

The legacy shell fallback is a second implementation with different behavior: it uses a 1,200-token notice threshold and reads files with shell `cat`/inline Node (`hook-inject-memory.sh:13-24`, `:66-100`). Because the TypeScript file wins whenever present, the fallback is not the normal current path.

### Agent turn and subagents

The six JSON manifests declare roles, model tiers, and write/MCP/subagent permissions. `agent-launcher.ts` reads every `agents/*.json`, resolves `system_prompt_file` relative to the agents directory, and returns a normalized descriptor (`plugins/agy-memory-layer/scripts/agent-launcher.ts:11-33`, `:37-68`). It does not itself spawn a model or invoke a subagent API; it is a resolver/inspection utility. The Antigravity host or the skill instructions remain responsible for actual execution.

### Stop path

```text
Stop event
  -> hook-auto-commit.sh
  -> hook-auto-commit.ts (preferred when present)
       -> git status in ~/.gemini/memory
       -> retry git add/commit
       -> detached dream-daemon.ts --auto-check
       -> { decision: "stop" }
```

The TypeScript implementation checks for a MemFS Git repository, detects dirty state, retries around `index.lock`, commits, and launches the daemon detached (`plugins/agy-memory-layer/scripts/hook-auto-commit.ts:22-95`). However, `runStopHook()` computes its script directory with `path.dirname(__filename)` (`hook-auto-commit.ts:98-105`). This repository is ESM (`package.json:4`), so `__filename` is undefined. The current wrapper selects this implementation (`hook-auto-commit.sh:6-11`), and the recorded test failure is exactly `ReferenceError: __filename is not defined in ES module scope` (`TEST_REPORT.md:25-38`). The shell fallback that would have returned JSON is therefore bypassed.

The same module-runtime mistake exists in the daemon's optional cron-install path: `dream-daemon.ts:378-390` uses `path.resolve(__filename)` when constructing a cron command. The normal background `--auto-check` path does not use that line, but `--install-cron` is independently vulnerable.

### Dream lifecycle

`dream-daemon.ts` scans Antigravity transcript directories at `~/.gemini/antigravity-cli/brain/<conversation>/.system_generated/logs/transcript.jsonl`, filters by minimum step count and idle time, avoids IDs already represented in learning files, and synthesizes Markdown from user prompts, tool names, and error-like content (`dream-daemon.ts:118-173`, `:176-244`). It writes dated learning files, tracks step counts in `.dream_state.json`, and commits MemFS changes (`dream-daemon.ts:247-313`). The Stop hook only triggers the step-count check asynchronously; the full synthesis is intentionally outside the synchronous hook.

### Other command entry points

- `/init` maps to `init-project-memory.ts`; it scans manifests and writes `project.md`/`rules.md` under the external memory root (`init-project-memory.ts:56-184`, `:245-307`).
- `/memory search` maps to `memory-search.ts`, a recursive Markdown line search with simple term-count ranking (`memory-search.ts:27-83`).
- `/recall` maps to `recall-engine.ts`, which reads transcript logs and fuses BM25 with character n-gram cosine similarity (`recall-engine.ts:194-291`).
- `/persona` maps to `switch-persona.ts`, which loads prompt presets and writes/commits `global/persona.md` (`switch-persona.ts:23-73`, `:105-145`).
- `/palace` maps through `palace-server.sh` to `palace-generator.ts`; it generates `/tmp/agy-memory-palace.html` by default and can open it (`palace-server.sh:4-35`).
- `/sync` is a shell Git remote manager (`sync-memory.sh:15-84`).
- `/sync-letta` maps to `letta-sync.ts`, which discovers Letta agents and imports raw memory/reference/project data (`letta-sync.ts:164-243`, `:248-297`, `:333-516`).
- Advanced scripts (`memory-compactor.ts`, `skill-synthesizer.ts`, `cross-project-synapse.ts`, `memory-approval.ts`, `ts-inspector.ts`, and `worktree-manager.ts`) expose exported functions and direct CLI modes, but are not wired into `hooks.json`.

## 3. Core abstractions and data flow

### Primary state model

The persistent schema is a Git repository with global and project scopes:

```text
~/.gemini/memory/
├── .git/
├── global/
│   ├── human.md
│   ├── persona.md
│   └── reference/                 optional Letta imports
└── projects/<slug>/
    ├── project.md
    ├── rules.md
    └── learnings/*.md
```

The plugin-local rules document describes the intended hierarchy (`plugins/agy-memory-layer/rules/AGENTS.md:60-69`). Code also creates transient `.dream_state.json`, `.approval_policy.json`, and `.pending_approvals/` at the memory root (`dream-daemon.ts:44-47`, `memory-approval.ts:47-60`). These transient/control files are part of the same Git tree unless excluded by a caller.

### Type-level service contracts

The code consistently uses exported `type` aliases rather than classes or interfaces. Examples include:

- Hook envelopes: `PreInvocationPayload`, `InjectStep`, `PreInvocationOutput` (`hook-inject-memory.ts:14-27`) and `StopPayload`/`StopOutput` (`hook-auto-commit.ts:14-20`).
- Onboarding state: `CodebaseScanResult`, `InitOptions`, `InitResult` (`init-project-memory.ts:13-40`).
- Search documents/results: `ConversationDoc`, `RecallHit`, `BM25Stats` (`recall-engine.ts:22-49`).
- Declarative subagent resolution: `SubagentConfig`, `ResolvedSubagent` (`agent-launcher.ts:11-33`).
- Portable backups: `MemoryBackupManifest`, `MemoryBundle`, verification/import result types (`tools/memory-backup.ts:21-96`).

This makes the service boundary easy to test as pure functions, but there is no shared domain package: each script owns its own path resolution, token heuristic, slug logic, and commit behavior.

### End-to-end data flow

```text
Workspace files/manifests
  -> init-project-memory.ts
  -> ~/.gemini/memory/projects/<slug>/{project.md,rules.md}

~/.gemini/memory/{global,projects}
  -> hook-inject-memory.ts
  -> ephemeralMessage before each Antigravity turn

Antigravity brain transcripts
  -> dream-daemon.ts
  -> projects/<slug>/learnings/*.md + .dream_state.json

Antigravity brain transcripts
  -> recall-engine.ts
  -> ranked historical conversation hits

Letta ~/.letta/agents and ~/.letta/projects
  -> letta-sync.ts
  -> merged MemFS human/rules/references

MemFS learnings
  -> cross-project-synapse.ts / skill-synthesizer.ts / memory-compactor.ts
  -> notices, draft skills, compacted/archived memory

MemFS tree
  -> memory-backup.ts
  -> verified JSON bundle -> restore to another MemFS
```

Important boundaries and omissions:

- **Project slug resolution is duplicated.** The hook prefers an existing basename directory and only then considers an existing remote-derived `<org>-<repo>` directory (`hook-inject-memory.ts:29-56`); the initializer uses the Git-root basename (`init-project-memory.ts:45-54`); the skill runbooks and doctor instructions use a workspace basename. A newly initialized project can therefore be written under one slug and injected under another unless the existing-memory heuristic happens to reconcile them.
- **Letta persona is extracted but not persisted.** `AgentPayload` contains `personaRaw` (`letta-sync.ts:38-44`), and `LettaSyncResult` exposes `globalPersonaUpdated`, but the current sync function sets that flag to `false` and only processes human content, references, and project rules (`letta-sync.ts:367-371`, `:373-481`). The advertised “core memory” bridge currently does not sync `persona.md`.
- **Approval is an opt-in service, not an enforcement boundary.** `memory-approval.ts` marks project/rules files as `explicit` (`memory-approval.ts:47-60`) and can create proposals (`:119-191`), but initializer, dream, compactor, persona, and Letta code write/commit directly. The repository-wide call sites are tests and the approval script's own CLI, not the writers that need enforcement.
- **Advanced capabilities are mostly pull/CLI based.** For example, `formatSynapseNotice()` is exported and used by the synapse script's own CLI (`cross-project-synapse.ts:199-230`), but the PreInvocation hook never imports it. Cross-project knowledge is therefore not automatically injected despite being described as a system capability.

## 4. Dependency and tooling architecture

### Runtime/toolchain

- `package.json` declares ESM (`type: module`), Node scripts, and only three dev dependencies: Biome, Node types, and TypeScript (`package.json:1-13`, `:26-30`). There are no production dependencies.
- `tsconfig.json` is strict, NodeNext, no-emit, and includes `tools`, `tests`, and plugin TypeScript/JavaScript (`tsconfig.json:2-15`).
- Biome owns formatting/linting with Git-aware ignores and recommended rules (`biome.json:3-34`).
- Tests run `tsc --noEmit` and Node's native test runner with `--experimental-strip-types` (`package.json:7-13`).
- `pnpm-lock.yaml` is present and pins the dev toolchain (`pnpm-lock.yaml:7-19`), while the scripts and docs generally present npm as the package manager (`package.json:7-9`, `AGENTS.md:46-48`). The initializer will classify this repository as pnpm because it checks `pnpm-lock.yaml` first (`init-project-memory.ts:122-131`). Package-manager ownership is therefore ambiguous.

### Direct-source execution

There is no build or packaging step. Shell wrappers and runbooks execute `.ts` files directly with Node's type stripping, for example `hook-inject-memory.sh:6-10`, `palace-server.sh:31`, and `tools/memory-backup.ts:686-693`. This keeps the bundle simple, but makes Node version selection part of the runtime contract.

The onboarding guide claims Node `v20+` (`docs/onboarding.md:7-12`), while the current wrapper architecture depends on `--experimental-strip-types` and the README advertises Node `v22+` (`README.md:3-6`). No `engines` field or installer dependency check enforces the stricter runtime.

`ts-inspector.ts` imports `typescript` as a runtime module (`ts-inspector.ts:9-12`), but TypeScript is only a dev dependency. The installers chmod and link files but do not install the repository's dependencies (`install.sh:40-42`, `plugins/agy-memory-layer/scripts/install.sh:13-15`). A standalone end-user install may therefore fail when invoking the inspector unless the host already supplies TypeScript.

The Palace HTML also loads `marked` from a public CDN (`palace-generator.ts:607-608`), so rendered Markdown requires network availability and introduces an external browser dependency even though the TypeScript services otherwise claim zero external runtime dependencies.

### Test architecture

The test suite is broad and exercises hooks, isolation, palace generation, Git rollback, native `agy` validation, onboarding, search, sync, and backup (`tests/run-test-suite.ts:62-482`). Unit coverage imports almost every advanced service directly (`tests/unit-coverage.test.ts:12-57`). This is a good functional surface, but the main harness uses the real `~/.gemini/memory/` path (`tests/run-test-suite.ts:16-20`) and performs real commits, reverts, and remote configuration changes (`:104-134`, `:246-284`, `:438-461`). It is not hermetic; a mid-test failure can leave external memory or Git state altered.

## 5. Current strengths

1. **Clear state isolation.** User/project memory is deliberately outside workspace Git trees, and the hook/installer topology makes that boundary explicit (`AGENTS.md:7-24`; `install.sh:43-76`).
2. **Auditable persistence.** Most writers commit to the external Git repository, and the backup tool adds per-file and manifest SHA-256 verification (`tools/memory-backup.ts:178-256`, `:259-375`).
3. **Composable TypeScript services.** Pure functions such as `scanCodebase`, `searchMemory`, `searchRecall`, `findCrossProjectSynapses`, and `compactMarkdownContent` are directly importable and testable.
4. **Non-blocking intent in lifecycle design.** The Stop hook separates synchronous snapshot work from detached dream processing (`hook-auto-commit.ts:72-95`), and the daemon owns transcript synthesis rather than doing it inline.
5. **Explicit subagent permissions.** The six manifests distinguish read-only recall agents from write-capable memory/dream/onboarding agents (`agents/recall_agent.json:2-9`, `agents/dream_agent.json:2-9`).
6. **Good operational breadth.** Onboarding, recall, search, persona management, compaction, backup, Letta import, cross-project search, palace visualization, and worktree isolation are separate concerns rather than one monolithic script.
7. **The current report is honest about a regression.** `TEST_REPORT.md` records 10/11 scenarios passing and identifies the Stop-hook ESM failure (`TEST_REPORT.md:10-17`, `:25-38`) instead of claiming a green lifecycle.

## 6. Architectural risks and current defects

| Severity | Finding | Evidence and impact |
|---|---|---|
| Critical | Current Stop hook is broken in the preferred path. | `hook-auto-commit.sh:6-11` always delegates to the new `.ts`; `hook-auto-commit.ts:102` uses `__filename`; `TEST_REPORT.md:25-38` records the resulting crash. Dirty MemFS changes may not be committed and the hook may not emit its required decision JSON. |
| High | Runtime/documentation contract is split between `.js`, `.ts`, Node, and Bun. | The actual tracked scripts are TypeScript, but `docs/file-organization.md:69-82`, `docs/development-commands.md:21-77`, `skills/recall/SKILL.md:21-25`, and `skills/dream/SKILL.md:50-63` invoke `.js`. The current persona skill invokes `bun` (`skills/persona/SKILL.md:21-24`) while the package/test/install contract is Node. New maintainers can follow a command that does not exist or requires an undeclared runtime. |
| High | Hook schema documentation disagrees with executable output. | `docs/patterns/services-pattern.md:20-26` illustrates `hookSpecificOutput.ephemeralMessage`; `hook-inject-memory.ts:25-27`, `:173-179` and tests (`tests/run-test-suite.ts:81-96`) use `{ injectSteps: [{ ephemeralMessage }] }`. Only one shape can be the host contract. |
| High | Approval policy is not centrally enforced. | The explicit policy is defined in `memory-approval.ts:47-60`, but direct writers such as `init-project-memory.ts:278-297` and `letta-sync.ts:486-498` bypass it. “Explicit approval” is currently a callable utility, not a protection around all mutations. |
| High | Untrusted backup paths are not confined to the target directory. | Import constructs `path.join(targetDir, fileEntry.relativePath)` and writes it (`tools/memory-backup.ts:403-459`). A malicious bundle containing `../` path segments could escape `targetDir`; `--clean` also removes every scanned existing file under the target (`:431-440`). Bundle path normalization and target containment checks are missing. |
| Medium | Slug algorithms can split a project's read/write location. | Hook remote-aware resolution (`hook-inject-memory.ts:29-56`) differs from initializer Git-basename resolution (`init-project-memory.ts:45-54`) and skill/doctor basename recipes. This can cause “initialized but not injected” memory. |
| Medium | Persona is a persisted concept but absent from normal context injection and Letta sync. | The hook reads human/project/rules only (`hook-inject-memory.ts:122-160`); Letta sync carries `personaRaw` but never writes it (`letta-sync.ts:38-44`, `:367-371`). Persona changes may be visible in the palace but not affect prompt context. |
| Medium | Duplicate shell/TypeScript implementations can diverge. | The fallback hook has a 1,200-token threshold (`hook-inject-memory.sh:83-100`), while the preferred TS hook uses 1,400 (`hook-inject-memory.ts:167-170`). The current uncommitted change makes the fallback largely dead code, increasing maintenance cost. |
| Medium | Advanced services are not part of the core runtime graph. | `hooks.json` registers only two hooks (`hooks.json:3-18`); compactor, approval, synapse, skill synthesis, inspector, and worktree manager are standalone CLIs/exported modules. Features described as “automatic” are not automatically invoked by the lifecycle. |
| Medium | Installation has a hidden dependency and runtime-version risk. | `ts-inspector.ts:11` requires TypeScript, but installers do not install dependencies; docs allow Node 20 while scripts use type stripping. End-user installs can pass hook validation yet fail on optional tools. |
| Medium | Test verification is stateful and can be destructive to external test state. | The integration harness targets the real home MemFS (`run-test-suite.ts:16-20`) and commits/reverts/removes data during tests (`:104-134`, `:246-284`). It also regenerates `TEST_REPORT.md` (`:487-541`), so running tests is not a read-only architecture probe. |
| Medium | Current local configuration is not Git-ignored. | `.gitignore:1-8` omits `.letta/`, while `git status` shows an untracked `.letta/` directory. Broad staging could capture local Letta configuration. |
| Low/Medium | Memory and palace reads are unbounded at the file level. | The hook reads full core Markdown files and only adds a warning after an estimate (`hook-inject-memory.ts:130-170`); palace reads all project learnings and embeds them into HTML (`palace-generator.ts:268-327`, `:1813-1817`). Large or sensitive memory can increase latency or be copied into a shareable artifact. |

## 7. Proven documentation-vs-code drift

These are direct contradictions, not inferred style differences:

1. **Versioned file names:** `CONTRACT.md` describes `init-project-memory.js`, `memory-search.js`, `recall-engine.js`, `switch-persona.js`, and `palace-generator.js` (`CONTRACT.md:69-81`), while the current runtime files are `.ts` and the tests import `.ts` (`tests/unit-coverage.test.ts:12-57`). `AGENTS.md` also names `palace-generator.js` in its version-bump surfaces (`AGENTS.md:49-55`).
2. **Skill count:** `docs/file-organization.md:57-67` documents ten skills, but `plugins/agy-memory-layer/skills/sync-letta/SKILL.md:1-8` is an additional current skill. The current `agy` test detail also says “7 skills” (`TEST_REPORT.md:42`), so at least three counts are in circulation.
3. **Test status/count:** root guidance says the expected suite is “9/9 ... 100% Green” (`AGENTS.md:64-79`), while the current generated report says 11 scenarios, 10 passed, 1 failed (`TEST_REPORT.md:10-17`). The README badge still advertises 16/16 (`README.md:3-6`).
4. **Stop-hook guarantee:** the rules claim the Stop hook always commits modified memory (`plugins/agy-memory-layer/rules/AGENTS.md:74-78`), but the current preferred implementation crashes before returning due to `__filename` (`hook-auto-commit.ts:98-115`; `TEST_REPORT.md:25-38`).
5. **`/memory` status mode:** the skill promises inspection/status behavior and invokes `memory-search.ts --status` (`skills/memory/SKILL.md:20-37`), but `memory-search.ts:85-105` treats its first argument as a search query and has no status branch.
6. **`/sync all`:** the skill documents `/sync all` (`skills/sync/SKILL.md:12-27`), while `sync-memory.sh:15-84` accepts `setup`, `push`, `pull`, `sync`, and `status`, not `all`.
7. **Hook envelope:** `docs/patterns/services-pattern.md:20-26` uses a `hookSpecificOutput` wrapper, but executable code and tests use `injectSteps` (`hook-inject-memory.ts:25-27`, `:173-179`; `tests/run-test-suite.ts:81-96`).
8. **Core-memory injection claim:** `CONTRACT.md:15` lists `persona.md` among blocks injected before every turn, but the current injection function only reads human, project, rules, and recent learnings (`hook-inject-memory.ts:122-160`).
9. **Package manager:** source detection prefers `pnpm` when `pnpm-lock.yaml` exists (`init-project-memory.ts:122-131`), whereas the root package scripts and engineering guidance present npm as the operational path (`package.json:7-13`; `AGENTS.md:46-48`).

## 8. Maintainer mental model

Think of the project as a **filesystem protocol adapter for Antigravity**, not as a server:

- **The plugin bundle is the control plane.** `hooks.json` defines the only hard lifecycle edges; `skills/`, `agents/`, `prompts/`, and `rules/` tell the host/agent what to do.
- **`~/.gemini/memory/` is the database.** Markdown files are the records, Git is the snapshot/audit mechanism, and project slugs are the partition key.
- **The PreInvocation hook is the read path.** It turns the current workspace plus MemFS into one ephemeral prompt message.
- **The Stop hook is the write checkpoint.** It should snapshot memory and schedule heavier reflection, but its current TypeScript path needs repair before this guarantee is trusted.
- **`brain/` and `.letta/` are upstream sources.** Dream/recall consume brain transcripts; Letta sync imports selected agent memory into MemFS.
- **Most “engines” are offline workers.** Recall, compaction, synapse matching, skill synthesis, backup, palace generation, and worktree management are independent scripts that share the filesystem, not a shared service bus.
- **Source and tests are the current truth.** Treat README, CONTRACT, and older docs as useful intent/history, but verify every command and file extension against `plugins/agy-memory-layer/scripts/`, `skills/`, and `tests/`.

A new maintainer should start in this order: `AGENTS.md` -> `hooks.json` -> the two shell wrappers and their preferred TypeScript implementations -> the MemFS schema -> `agent-launcher.ts`/manifests -> the individual skills and tests. Before making a broad change, check slug resolution, direct Git commits, external paths, and whether the change is included in the current `npm test` path.

## Recommended next steps

1. Fix the ESM path resolution in `hook-auto-commit.ts` and the cron branch in `dream-daemon.ts`, then add a direct Stop-hook regression that asserts JSON output and a committed marker.
2. Choose one runtime contract (Node version, `.ts` direct execution, and package manager), make installers validate/install it, and remove or regenerate stale `.js`/Bun instructions.
3. Centralize project-slug resolution and route all memory mutations through the approval policy if approval is intended to be a real invariant.
4. Harden backup import with normalized relative paths and target containment checks; make integration tests use a temporary MemFS by default.
5. Regenerate or rewrite the architecture docs from current source ownership, including the actual 11 skills, hook envelope, current test status, and persona/Letta behavior.
