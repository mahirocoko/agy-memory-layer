# `agy-memory-layer` quick reference

> **Current-tree snapshot:** 2026-08-20. This reference describes the checked-out implementation, including uncommitted changes; it does not treat README claims as runtime proof.

## What it does today

`agy-memory-layer` is an MIT-licensed Antigravity CLI (`agy`) plugin that gives agents an external, Git-versioned memory filesystem (MemFS). Its published package identity is version **1.12.0** (`package.json`, `plugins/agy-memory-layer/plugin.json`).

At runtime it is intended to:

1. **Inject memory before each turn.** `hooks.json` registers `scripts/hook-inject-memory.sh` for `PreInvocation` (5-second timeout). The current TypeScript implementation resolves a workspace slug, reads `~/.gemini/memory/global/human.md`, project `project.md`, project `rules.md`, and the two most recently modified learning files, then emits them as an AGY `injectSteps[].ephemeralMessage` payload (`scripts/hook-inject-memory.ts`).
2. **Snapshot memory after a turn.** `hooks.json` registers `scripts/hook-auto-commit.sh` for `Stop` (10-second timeout). The hook stages and commits dirty MemFS state, then detaches an Auto-Dream check (`scripts/hook-auto-commit.ts`).
3. **Onboard a codebase.** `/init` invokes `init-project-memory.ts` to detect common manifests, entry points, scripts, linters, and docs, then create project-scoped memory (`skills/init/SKILL.md`).
4. **Retrieve prior knowledge.** `/memory search` searches MemFS files; `/recall` is intended to query Antigravity transcript history using BM25 plus subword n-gram/cosine scoring (`skills/memory/SKILL.md`, `skills/recall/SKILL.md`, `scripts/recall-engine.ts`).
5. **Consolidate sessions.** `dream-daemon.ts` scans `~/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript.jsonl`, writes dated learning logs, and commits them. Its default threshold is 20 steps; ordinary scans require at least 8 steps and 15 minutes idle time.
6. **Operate and visualize memory.** It includes persona switching, private-Git sync, Letta-memory import, backups with SHA-256 verification, a Memory Palace HTML dashboard, and several TypeScript-based utility engines.

## Prerequisites and installation

### Required environment

- **Node.js 22+ in practice.** README badges specify v22+ and scripts use Node's `--experimental-strip-types`; `package.json` has no runtime dependencies.
- **Git.** MemFS is a separate Git repository and scripts invoke `git` directly.
- **Antigravity CLI 1.1+.** This is the target host (`docs/onboarding.md`); installation attempts `agy plugin install` only if `agy` is on `PATH`.
- macOS is the recently recorded test environment, but the current TypeScript hook code describes itself as cross-platform. Cron installation is Unix `crontab` based.

### Install from a clone

```bash
git clone https://github.com/mahirocoko/agy-memory-layer.git
cd agy-memory-layer
./install.sh
```

One-line distribution is also documented:

```bash
curl -fsSL https://raw.githubusercontent.com/mahirocoko/agy-memory-layer/main/install.sh | bash
```

The root `install.sh`:

- initializes `~/.gemini/memory/` as Git (branch `main` where supported),
- seeds `global/human.md` and `global/persona.md` only if absent,
- symlinks the plugin to both `~/.gemini/antigravity-cli/plugins/agy-memory-layer` and `~/.gemini/config/plugins/agy-memory-layer`,
- marks shell scripts executable,
- optionally runs `agy plugin install <source>`, and
- exercises both hook wrappers with JSON input.

## Memory storage model

MemFS intentionally lives **outside the workspace**:

```text
~/.gemini/memory/                  # standalone Git repository
├── global/
│   ├── human.md                   # cross-project user preferences
│   └── persona.md                 # active agent behavior/personality
├── projects/
│   └── <project-slug>/
│       ├── project.md             # architecture/domain context
│       ├── rules.md               # project conventions
│       └── learnings/             # dated durable notes
├── .dream_state.json              # daemon state
├── .approval_policy.json          # optional write policy
└── .pending_approvals/            # pending explicit proposals
```

Slug resolution in `hook-inject-memory.ts` first uses the lowercased workspace basename (spaces become `-`). If that directory does not exist, it can use an existing canonical `<owner>-<repo>` directory derived from `remote.origin.url`; otherwise it falls back to the basename.

### Memory writes and approvals

`memory-approval.ts` supplies a separate policy mechanism. Its default policy auto-commits updates to global `human.md`, `persona.md`, and `learnings/*`, but requires explicit approval for `projects/*/project.md` and `projects/*/rules.md`. Pending proposals are JSON files in `.pending_approvals`; approve/reject them with:

```bash
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-approval.ts list
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-approval.ts approve <proposal-id>
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-approval.ts reject <proposal-id>
```

This approval module is not referenced by `hooks.json`, so treat it as an opt-in utility rather than proof that every agent write is gated.

## Plugin features, hooks, agents, and skills

### Hooks

| Event | Command | Behavior |
|---|---|---|
| `PreInvocation` | `./scripts/hook-inject-memory.sh` | Prefer the TypeScript hook via Node type stripping; inject global/profile, project, rules, and recent learnings. The TypeScript budget notice fires above approximately 1,400 estimated tokens (`length / 4`). |
| `Stop` | `./scripts/hook-auto-commit.sh` | Prefer the TypeScript hook; Git-add/commit dirty MemFS (up to 3 retries), then start detached `dream-daemon.ts --auto-check`. |

### Six declarative agents

All manifests disable MCP and nested-subagent tools. Write permission is limited as below.

| Agent | Model tier | Access | Purpose |
|---|---:|---|---|
| `dream_agent` | `inherit` | write | Reflect on transcripts and update MemFS. |
| `memory_agent` | `inherit` | write | Maintain `human.md`, `project.md`, and `rules.md`. |
| `onboarding_agent` | `flash` | write | Scan a new repository and bootstrap memory. |
| `skill_creator_agent` | `pro` | write | Create and validate Antigravity skills. |
| `recall_agent` | `flash` | read-only | Retrieve historical transcript facts. |
| `history_analyzer_agent` | `flash` | read-only | Investigate multi-step historical/debugging traces. |

### User-facing skills

| Command | Practical use |
|---|---|
| `/init [--force]` | Scan the current repository; create/rebaseline project memory. |
| `/memory search <query>` | Search MemFS learning files. The current script does not implement the documented status/inspection mode yet. |
| `/recall <query>` | Hybrid, semantic-only, keyword-only, or session-list transcript recall. |
| `/remember <fact>` | Record a global or project-scoped fact and commit it. |
| `/persona [memo\|linus\|tutor\|architect]` | Inspect/switch the persona stored in global memory. |
| `/dream` | Have the reflection workflow distill the current transcript; see daemon commands below for automated processing. |
| `/doctor` | Check Git health, slug resolution, memory files, and drift against the workspace. |
| `/palace [--summary]` | Open/generate the memory graph/timeline dashboard or show an in-chat summary. |
| `/sync [setup\|status\|pull\|push\|sync]` | Configure and synchronize MemFS with a private Git remote. `all` is documented by the skill but not accepted by the current shell script. |
| `/sync-letta` | Discover a Letta stateful agent, extract raw memory, then groom/deduplicate before import. |
| `/update` | Refresh the active plugin symlink, shell executable bits, and hook validation while preserving MemFS. |

## Important commands and configuration

### Development quality gates

```bash
npm test                 # tsc --noEmit, then Node tests serially
npm run test:coverage    # native V8 coverage variant
npm run typecheck
npm run check            # typecheck + biome check .
npm run lint
npm run format           # writes formatting changes
npm run fix              # writes Biome fixes
```

The package uses TypeScript 5.8.2, Biome 2.5.9, and `@types/node` 26.2.0 as dev dependencies. Root `AGENTS.md` requires `type` aliases rather than TypeScript `interface`, exact-version dependency installation (`npm i -E`), and user approval after test/diff review before a commit.

### Direct operational scripts

Use Node type stripping for existing `.ts` files:

```bash
# Dream queue, immediate processing, or cron management
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --status
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --run-now [--force]
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --install-cron
node --experimental-strip-types plugins/agy-memory-layer/scripts/dream-daemon.ts --uninstall-cron

# Recall and memory search
node --experimental-strip-types plugins/agy-memory-layer/scripts/recall-engine.ts search "topic" --semantic
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-search.ts "query"

# Other engines
node --experimental-strip-types plugins/agy-memory-layer/scripts/ts-inspector.ts check
node --experimental-strip-types plugins/agy-memory-layer/scripts/memory-compactor.ts compact
node --experimental-strip-types plugins/agy-memory-layer/scripts/skill-synthesizer.ts scan
node --experimental-strip-types plugins/agy-memory-layer/scripts/cross-project-synapse.ts "docker setup"

# Letta discovery/payload (then use a human-reviewed grooming step)
node --experimental-strip-types plugins/agy-memory-layer/scripts/letta-sync.ts list
node --experimental-strip-types plugins/agy-memory-layer/scripts/letta-sync.ts payload --agent-id <agent-id>
node --experimental-strip-types plugins/agy-memory-layer/scripts/letta-sync.ts status --dry-run

# Backup/export, integrity check, and restore
node --experimental-strip-types tools/memory-backup.ts export -o ./memory-backup.json
node --experimental-strip-types tools/memory-backup.ts verify -i ./memory-backup.json
node --experimental-strip-types tools/memory-backup.ts import -i ./memory-backup.json
```

### Lifecycle management

```bash
agy plugin disable agy-memory-layer
agy plugin enable agy-memory-layer
bash plugins/agy-memory-layer/scripts/update.sh
bash plugins/agy-memory-layer/scripts/uninstall.sh         # preserves MemFS
bash plugins/agy-memory-layer/scripts/uninstall.sh --purge # deletes all MemFS
```

`/sync push` and the direct sync script can send personal memory to a remote; use only a private, reviewed remote. The default safe uninstall retains memory, while `--purge` recursively deletes `~/.gemini/memory/`.

## Test and release workflow

1. Make changes using repository conventions; synchronize the version in all five surfaces required by root `AGENTS.md`: `package.json`, `plugin.json`, `palace-generator.ts`, `CONTRACT.md`, and the relevant MemFS project `project.md`.
2. Run `npm test` and, when appropriate, `npm run check` / `npm run test:coverage`.
3. Run `agy plugin validate plugins/agy-memory-layer` in an installed AGY environment.
4. Review `git status --short` and `git diff --stat` with the user. Do not auto-commit or push.
5. On approval, use Conventional Commit format (`type(scope): description`). No AI attribution trailer.
6. Distribute via a release tag and the root `install.sh` one-liner; test installation from a clean machine/fixture before release.

## Known limitations and current gaps

These are current-tree evidence, not theoretical concerns:

- **Stop hook is currently broken in the supplied test report.** The uncommitted `TEST_REPORT.md` dated 2026-08-20 records 10/11 scenarios passing and the Stop-hook test failing because `hook-auto-commit.ts:102` references CommonJS `__filename` in ESM: `ReferenceError: __filename is not defined in ES module scope`. Because the shell wrapper prefers that `.ts` file, the normal Stop path fails before launching Dream, so automatic snapshots and auto-dream should be considered unavailable until fixed and re-tested.
- **Documentation and implementation drift on file extensions.** Many skills/docs call `.js` files (`dream-daemon.js`, `recall-engine.js`) while this tree contains `.ts` versions. Use `node --experimental-strip-types <file>.ts` as shown above.
- **Feature-count drift.** README claims 11 automated suites/16 tests and root `AGENTS.md` says 9/9 suites, whereas the current test harness executes 10 named scenarios plus Node unit coverage input, and the current report says 11 scenarios/10 passing. Validate claims with a fresh test run after fixing the hook.
- **Token-budget values conflict.** `hook-inject-memory.ts` warns above ~1,400 tokens; the POSIX fallback uses ~1,200; `docs/best-practices.md` says 4,000. The TypeScript hook is the active path when present.
- **The project/test suite mutates external MemFS and a repository report.** `tests/run-test-suite.ts` writes temporary files/projects under `~/.gemini/memory/`, creates/reverts Git commits there, temporarily changes its `origin`, and overwrites root `TEST_REPORT.md`. Run it only with a disposable/recoverable MemFS or accept those side effects.
- **Some stated safety guarantees overreach.** The Stop hook stages all MemFS changes (`git add -A`). `/remember` likewise stages all memory changes. The separate approval policy is not automatically wired into hooks/skills. Review MemFS content, particularly before remote sync.
- **The codebase itself has uncommitted work.** At inspection: modified `TEST_REPORT.md`, plugin rules, both hook wrappers, `letta-sync.ts`, and persona skill; untracked `.letta/` plus new TypeScript hook files. Do not assume a clean/released baseline.

## Shortest-path onboarding checklist

1. Install Node 22+, Git, and `agy` 1.1+; clone the repository.
2. Run `./install.sh`; verify the plugin symlink and `git -C ~/.gemini/memory log --oneline`.
3. Before depending on persistence, run the hooks/tests in a disposable MemFS and address the known Stop-hook ESM failure.
4. Open a target repository in AGY, then run `/init` to generate `projects/<slug>/project.md` and `rules.md`.
5. Inspect `~/.gemini/memory/global/` and the resolved project directory directly to confirm the expected blocks; use `/memory search <query>` for implemented search behavior and `/remember` to add a reviewed preference.
6. Use `/recall <topic>` for prior transcript context and `/dream` (or the daemon) to turn completed sessions into concise learning notes.
7. Run `/doctor` periodically; keep injected memory compact and resolve contradictory rules.
8. If multi-device continuity is wanted, create a **private** remote, run `/sync setup <url>`, review status, then explicitly pull/push.
9. Use `/palace` for a visual audit and `tools/memory-backup.ts export/verify` before migrations or destructive cleanup.
