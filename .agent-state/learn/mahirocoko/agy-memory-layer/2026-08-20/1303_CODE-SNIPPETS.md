# `agy-memory-layer` implementation patterns

## Scope and current-tree basis

This report reads the current working tree at `/Users/mahiro/Git/me/sandbox/learn-letta-code`, including uncommitted hook migration files. It does not assert that the tree is clean or that every documented command is executable in the current runtime.

The system is a plugin that keeps durable data outside the workspace in Git-backed MemFS at `~/.gemini/memory`; plugin metadata establishes that purpose in `plugins/agy-memory-layer/plugin.json:2-6`, while the repository contract is stated in `AGENTS.md:9-24`.

## Main entry points and lifecycle hooks

| Entry point | Evidence | Pattern |
| --- | --- | --- |
| Plugin lifecycle registration | `plugins/agy-memory-layer/hooks.json:2-19` | Antigravity invokes shell wrappers: `PreInvocation -> ./scripts/hook-inject-memory.sh` (5-second timeout) and `Stop -> ./scripts/hook-auto-commit.sh` (10-second timeout). |
| Injection wrapper | `plugins/agy-memory-layer/scripts/hook-inject-memory.sh:4-11` | Wrapper prefers Node's type-stripping execution of the new `.ts` hook, then a `.js` artifact, then retains a POSIX implementation. |
| Injection implementation | `plugins/agy-memory-layer/scripts/hook-inject-memory.ts:109-180`, CLI bridge at `:183-200` | Parses stdin JSON, selects a workspace, reads MemFS, and emits `{ injectSteps: [{ ephemeralMessage }] }`. |
| Stop wrapper | `plugins/agy-memory-layer/scripts/hook-auto-commit.sh:4-11` | Same TypeScript/JavaScript/POSIX dispatch strategy. |
| Stop implementation | `plugins/agy-memory-layer/scripts/hook-auto-commit.ts:22-105`, CLI bridge at `:108-115` | Snapshots dirty MemFS, starts auto-dream detached, then unconditionally returns `{ decision: 'stop' }`. |
| User-facing CLIs | `init-project-memory.ts:310-333`, `memory-search.ts:85-105`, `recall-engine.ts:294-327`, `dream-daemon.ts:367-414`, `letta-sync.ts:522-595`, `memory-approval.ts:269-303` | Every service is both importable for tests and directly executable based on `process.argv[1]` suffix checks. |

### Injection pseudocode

```ts
payload = parseJSON(stdin) ?? {}
workspace = payload.workspacePaths?.[0] ?? process.cwd()
slug = resolveProjectSlug(workspace, memRoot)
context = read(global/human.md) + read(project.md) + read(rules.md)
context += recentTwoLearningExcerpts(slug)
return context ? { injectSteps: [{ ephemeralMessage: wrap(context) }] } : { injectSteps: [] }
```

Evidence: `hook-inject-memory.ts:109-180`. `resolveProjectSlug` first accepts an existing basename directory, then maps the Git remote's `owner/repo` to `owner-repo`, and otherwise returns the basename (`:29-57`). The selected project can therefore be stable across a renamed checkout only if its canonical MemFS directory already exists.

### Stop pseudocode

```ts
if (memRoot/.git exists && git status --porcelain is non-empty)
  retry git add -A + git commit up to 3 times
spawnDetached(dream-daemon.ts|js, '--auto-check')
return { decision: 'stop' }
```

Evidence: `hook-auto-commit.ts:22-105`. The TypeScript version checks and removes an `index.lock` older than five seconds before retries (`:39-63`); the legacy shell fallback performs one best-effort snapshot (`hook-auto-commit.sh:17-24`).

## Memory sync, injection, commit, and recall

### MemFS layout and writing paths

* **Initialization:** `initProjectMemory()` scans workspace metadata, writes `projects/<slug>/project.md` and `rules.md`, creates `learnings/`, and optionally snapshots them (`init-project-memory.ts:245-307`). The scanner detects language/tooling through manifests and a fixed entrypoint list (`:56-184`).
* **Injection:** only `global/human.md`, project `project.md`, `rules.md`, and excerpts from the two newest learning notes are inserted into the prompt (`hook-inject-memory.ts:59-106`, `:130-161`). It estimates tokens as `ceil(chars / 4)` and annotates contexts over 1,400 estimated tokens (`:167-173`).
* **Approval-controlled writes:** `memory-approval.ts:52-60` marks project context and rules as `explicit`, while profile and learning files default to `auto`. `proposeMemoryUpdate()` writes and commits auto paths but serializes explicit changes as `.pending_approvals/<id>.json` (`:119-191`). `reviewProposal()` applies or deletes the proposal; approval attempts a scoped Git commit (`:220-267`).
* **Compaction:** files are normalized/deduplicated and, with more than 15 learning notes, older notes are concatenated into a monthly archive (`memory-compactor.ts:78-180`, `:256-287`). The full compactor snapshots changed MemFS by default (`:332-385`).
* **Dreaming:** transcript scanning targets `~/.gemini/antigravity-cli/brain/<conversation>/.system_generated/logs/transcript.jsonl` (`dream-daemon.ts:43-47`, `:118-174`). Synthesized notes preserve conversation IDs and are written to dated `learnings` files; state persists in `.dream_state.json` and changes are committed (`:176-313`). A stop hook invokes the threshold route (`:316-337`).

### Letta-to-MemFS import

`letta-sync.ts` is a raw extractor/merger. It discovers `~/.letta/agents/agent-*`, reads system human/persona blocks, references, and project Markdown (`listStatefulAgents:164-243`; `extractAgentPayload:248-298`). It chooses a supplied agent, otherwise the first likely general agent, otherwise the newest agent (`findPrimaryLettaAgent:303-316`).

For global scope, it merges `human.md`, copies references, and merges each Letta project Markdown into `projects/<slug>/rules.md`; project scope instead treats the agent's `human.md` as project rules and copies references into project learnings (`syncLettaMemory:373-482`). `mergeMarkdownDocs()` preserves both inputs with a provenance header and only section-local bullet de-duplication (`:321-328`, `compactMarkdownContent:78-143`). Modified live imports stage all MemFS files and commit unless `autoCommit === false` (`:486-500`).

`plugins/agy-memory-layer/skills/sync-letta/SKILL.md:10-39` documents a stricter intended workflow: select an agent interactively, extract payload, then have an agent semantically groom and distill it. This grooming is not implemented inside `syncLettaMemory()` itself.

### Recall routes

Two retrieval surfaces differ materially:

1. **MemFS line search:** `searchMemory()` recursively scans non-hidden Markdown under MemFS, scores a line by number of query terms matched, sorts descending, and returns the first 20 by default (`memory-search.ts:27-82`).
2. **Episodic transcript recall:** `scanAllConversations()` parses every transcript JSONL into a conversation document (`recall-engine.ts:144-192`). `searchRecall()` fuses BM25 (40%) and a character 3-gram/whole-word cosine profile (60%), accepting scores above 0.08 or any exact token match (`:194-292`). It limits vectors to the first 8,000 characters of each conversation (`:245`).

Representative recall fusion:

```ts
bm25 = min(1, computeBM25(queryTokens, docTokens) / 15)
vector = cosine(queryVector, ngramVector(doc.text.slice(0, 8000)))
score = mode === 'hybrid' ? vector * 0.6 + bm25 * 0.4 : selectedScore
```

Evidence: `recall-engine.ts:240-261`. Tokenization retains Thai code points (`:56-62`), which is deliberate multilingual support rather than an ASCII-only keyword index.

## Error handling and operational stance

| Area | Evidence | Behavior |
| --- | --- | --- |
| Pre-invocation context | `hook-inject-memory.ts:39-56`, `:67-106`, `:109-115`, `:130-155` | **Fail open.** Invalid input, unavailable Git remote, unreadable files, and failed learning extraction are swallowed; an empty context returns valid empty injection JSON. |
| Stop lifecycle | `hook-auto-commit.ts:24-69`, `:72-105` | **Fail open to stopping.** Missing repo or failed commits return `false`, daemon launch errors are ignored, but hook output remains `{ decision: 'stop' }`. |
| Explicit approvals | `memory-approval.ts:220-223` | **Fail closed for absent proposal.** Reviewing an unknown ID throws. However, Git commit errors after an approved/auto write are swallowed (`:145-153`, `:248-259`), so a result can report success after an uncommitted write. |
| Input validation | `memory-search.ts:27-30`; `recall-engine.ts:194-200`; CLI checks at `:298-303` | **Fail closed for empty queries/required CLI args:** functions throw and CLI exits nonzero. |
| Letta sync | `letta-sync.ts:340-355`, `:486-500` | **Graceful no-data result** when `~/.letta` is absent. Extraction and individual filesystem reads are generally not guarded, while final Git errors are swallowed. |
| Remote sync | `sync-memory.sh:8-10`, `:30-61` | **Fail closed** for absent MemFS/remote on setup-dependent commands; **partially fail open** for `sync`, where failed pull is ignored before push. |

## TypeScript and shell interoperability

* The package is native ESM (`package.json:2-5`) and runs TypeScript directly via `node --experimental-strip-types` (`package.json:7-9`; shell wrappers at `hook-*.sh:7-10`). No runtime transpilation/build artifact is required for the active hook path.
* Shell remains the host-compatible contract boundary because `hooks.json` registers `.sh` commands. Both wrappers use `exec`, preserving stdin/stdout for JSON protocol forwarding.
* The TypeScript hooks use Node built-ins only: `child_process`, `fs`, `os`, and `path` (`hook-inject-memory.ts:9-12`; `hook-auto-commit.ts:9-12`). Their exported `type` aliases enable direct test imports.
* The fallback injection script duplicates slug resolution, context assembly, and JSON formatting in Bash plus inline CommonJS Node (`hook-inject-memory.sh:14-103`). It lacks the TypeScript branch's recent-learning injection and uses a different budget threshold (1,200 instead of 1,400; `:83-100` vs. `hook-inject-memory.ts:167-171`).

## Tests encoding key contracts

* **Hook schema and isolation:** `tests/run-test-suite.ts:65-97` requires parseable `injectSteps`; `:141-200` creates two MemFS projects and asserts no cross-project leakage while global profile appears in both.
* **Stop persistence:** `tests/run-test-suite.ts:99-136` dirties a MemFS marker, invokes the shell hook, and expects no remaining marker in `git status`.
* **Plugin and remote-sync contracts:** `tests/run-test-suite.ts:289-305` requires `agy plugin validate`; `:438-462` checks `sync-memory.sh status` and mutates a test remote.
* **Initialization and ordinary memory search:** `tests/run-test-suite.ts:344-409` checks detected React/Vite/TypeScript/Vitest data in seeded Markdown; `:414-432` expects a ranked TypeScript result.
* **Recall, dreaming, approvals, compaction, and Letta sync:** `tests/unit-coverage.test.ts:158-186`, `:188-210`, `:264-310`, `:340-383`, and `:492-561` directly import service functions and test math, generated learning content, policy routing, archival behavior, slug normalization, and sandbox import paths.

Tests were **not executed** for this report: `npm test` writes `TEST_REPORT.md` (`tests/run-test-suite.ts:541`) and its scenarios modify/commit the external MemFS, create worktrees, change remotes, and create temporary files. That conflicts with the request to write only this analysis file.

## Suspicious inconsistencies and migration seams

### Evidence

1. **A current migration is present.** The uncommitted tree adds `hook-inject-memory.ts` and `hook-auto-commit.ts` and changes both shell hooks to prefer them. `git diff -- plugins/agy-memory-layer/scripts/hook-*.sh` shows this dispatch addition. The hook registration remains shell-only (`hooks.json:6`, `:15`), so both TypeScript and POSIX branches are live compatibility surfaces.
2. **Documentation still names JavaScript artifacts that are absent from the plugin source listing.** `/recall` invokes `recall-engine.js` (`skills/recall/SKILL.md:21-25`), dream examples invoke `dream-daemon.js` (`skills/dream/SKILL.md:50-62`), and prompts do likewise (`prompts/subagents/recall_subagent*.md`). Current implementations are `.ts`, while no corresponding `.js` files appear under `scripts/`.
3. **Some code violates the repository's own type policy.** Root `AGENTS.md:36-37` says zero `any` where possible, yet `dream-daemon.ts:309` and `:393`/`:408` use `catch (err: any)` / `catch (e: any)`.
4. **Persona import is incomplete by implementation.** `AgentPayload` reads `personaRaw` (`letta-sync.ts:39-44`, `:253-258`), and result type reports `globalPersonaUpdated`, but that field is an immutable `false` (`:368`) and no branch writes `global/persona.md`.
5. **The approval policy is not a universal write gateway.** `memory-approval.ts` protects its callers, but initializer, dream daemon, compactor, Letta sync, and stop auto-commit write/commit directly (`init-project-memory.ts:274-300`; `dream-daemon.ts:260-311`; `memory-compactor.ts:209-211`, `:360-375`; `letta-sync.ts:393-498`; `hook-auto-commit.ts:51-55`).
6. **Test suite and root guide disagree on test inventory.** `AGENTS.md:72` says expected output is “9/9 test suites,” but `tests/run-test-suite.ts` defines 10 numbered suites, and `package.json:8` also runs `unit-coverage.test.ts`.
7. **Global persona is not injected by the active TypeScript hook.** The fallback defines `GLOBAL_PERSONA` but never reads it (`hook-inject-memory.sh:26-29`); the TypeScript hook only addresses `global/human.md` (`hook-inject-memory.ts:122-136`).

### Hypotheses (not proven by source alone)

1. The TypeScript hook dispatch is an in-progress cross-platform migration, and stale `.js` command examples will fail in source-only installs without generated artifacts. This is supported by the current untracked TypeScript hooks and documented `.js` invocations, but the packaging/release pipeline was not inspected.
2. Direct write paths likely predate the approval-policy layer. If callers are meant to honor explicit protection for `project.md` and `rules.md`, they need to route updates through `proposeMemoryUpdate()`; otherwise that policy only governs a subset of mutation sources.
3. The combination of automatic stop snapshots and explicit approval may intentionally version proposal metadata without applying protected content. However, because multiple services bypass the policy, the effective guarantee is weaker than the policy header claims.
