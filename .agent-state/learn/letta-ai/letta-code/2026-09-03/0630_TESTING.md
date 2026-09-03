# Testing Architecture & Verification System in `letta-code`

> **Analysis Date**: 2026-09-03  
> **Source Base**: `letta-ai/letta-code` (v0.31.6)  
> **Target Scope**: Test structure, execution engines, test utilities, isolation boundaries, mocking mechanics, coverage enforcement, and CI/CD verification matrix.

---

## Executive Summary

The `letta-code` codebase contains a mature, multi-layered verification system designed to maintain stability across a complex hybrid architecture: a Bun-powered developer environment and TUI, compiled Node.js CLI bundle, multi-platform native bindings (`node-pty`, `sharp`, `@janhapke/sharp-electron`), headless automation, and integration with both remote cloud and in-process local LLM backends.

With over **750 test files** spanning unit, component, contract, scenario, and integration tiers, the repository enforces strict architectural hygiene through automated validation scripts, family-based test impact analysis, deterministic environment preloads, and a custom module mock isolation checker.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Local Development & Pre-Commit                  │
│  .husky/pre-commit ──► biome lint ──► tsc ──► 12 architectural checks  │
└────────────────────────────────────┬───────────────────────────────────┘
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Unit & Component Test Tier                        │
│   scripts/run-unit-tests.cjs ──► scripts/unit-test-impact.cjs (PR)     │
│             │                                                          │
│             ├─► Bounded Shared Batches (≤20k chars per Bun invocation) │
│             └─► scripts/isolated-unit-tests.json (Standalone Processes)│
│                   └── Preloaded via scripts/test-home-preload.ts       │
└────────────────────────────────────┬───────────────────────────────────┘
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      CI / Cross-Platform Matrix                        │
│   GitHub Actions (macOS arm64, Linux x64/arm64, Windows x64)           │
│   ├── Native binary verification (sharp, node-pty)                     │
│   ├── API-gated integration tests (src/integration-tests/)             │
│   ├── Headless scenario tests (Cloud + Local + Ollama)                 │
│   └── Multi-shell global install verification (PowerShell, POSIX sh)   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Test Structure and Conventions

### 1.1 Test Runners and Execution Engines

`letta-code` standardizes on **Bun's native test runner (`bun:test`)** for executing all unit, component, and contract suites. Jest and Vitest are not used in the codebase:
- **Test execution command**: `bun test`
- **Orchestration wrapper**: `scripts/run-unit-tests.cjs` (manages test discovery, process isolation, batching, and environment sandboxing)
- **Runtime requirements**: Bun `>= 1.3.10` for testing; Node `>= 22.19` for production runtime bundle compatibility.

### 1.2 File Naming Conventions

The codebase uses consistent file extension patterns to indicate test purpose:

| File Pattern | Primary Purpose | Examples |
| :--- | :--- | :--- |
| `*.test.ts` | Unit, domain logic, and utility tests | `src/agent/create.test.ts`, `src/tools/bash.test.ts` |
| `*.test.tsx` | React / Ink terminal UI component tests | `src/cli/components/InlineQuestionApproval.test.tsx`, `src/cli/statusline-renderer.test.tsx` |
| `*.smoke.ts` | End-to-end smoke and update chain tests | `src/test-utils/message.smoke.ts`, `src/test-utils/update-chain-smoke.ts` |
| `*.test.cjs` | Scripts and tooling tests | `scripts/unit-test-impact.test.cjs` |

### 1.3 Strict Collocation Policy & The Forbidden Directory Rule

Unlike traditional repositories that place tests in a top-level `tests/` directory, `letta-code` strictly enforces **source-test collocation**:
- **Rule**: Every test file must reside directly alongside the implementation file it verifies (e.g., `src/cli/components/HelpDialog.test.tsx` next to `src/cli/components/HelpDialog.tsx`).
- **Enforcement**: Statically guarded by `scripts/check-test-coverage.cjs`:
  ```javascript
  const FORBIDDEN_DIRS = ["src/tests"];
  ```
  If any test file is added inside `src/tests`, the check immediately aborts with an error:
  `"Tests must be collocated with their source files, not in src/tests/. Move the test next to the module it tests."`

### 1.4 Test Directory Organization

The codebase divides tests into several clear architectural zones:

```text
src/
├── agent/                # Agent configuration, model routing, and memory policies (*.test.ts)
├── auth/                 # OAuth flow and credential resolution tests (*.test.ts)
├── backend/              # Client wrappers, API response parsing, local backend (*.test.ts)
├── channels/             # Slack, Telegram, Discord, WhatsApp adapters (*.test.ts)
├── cli/                  # TUI components, layout rendering, command handlers (*.test.ts, *.test.tsx)
├── cron/                 # Recurring scheduled job execution tests (*.test.ts)
├── helpers/              # Text formatting, stream processing, parsing utilities (*.test.ts)
├── hooks/                # Lifecycle hooks and prompt executor tests (*.test.ts)
├── integration-tests/    # API-gated integration suites (skipped during standard unit runs)
├── lsp/                  # Language Server Protocol client tests (*.test.ts)
├── mods/                 # Custom extension and mod loader tests (*.test.ts)
├── permissions/          # Permission mode checks (standard, acceptEdits, etc.) (*.test.ts)
├── providers/            # LLM provider adapter suites (*.test.ts)
├── reminders/            # Agent reminder and context toggle tests (*.test.ts)
├── sandbox/              # Subagent sandbox confinement tests (*.test.ts)
├── skills/               # Skill parsing and execution tests (*.test.ts)
├── telemetry/            # Event flushing, redaction, and batching tests (*.test.ts)
├── test-utils/           # Shared fixtures, test harnesses, and smoke scenarios
├── tools/                # Built-in agent tools (bash, memory, edit, web) (*.test.ts)
├── updater/              # Self-update checks and binary replacement tests (*.test.ts)
├── utils/                # Low-level primitives and helpers (*.test.ts)
└── websocket/            # Listener protocol, session management, and multiplexing (*.test.ts)
```

### 1.5 Process Segregation: Shared Batches vs. Isolated Runners

Because Bun applies module-level mocks globally across a worker process, running hundreds of stateful tests in a single process risks subtle cross-test pollution. `letta-code` solves this via a two-tier execution model in `scripts/run-unit-tests.cjs`:

1. **Isolated Unit Tests (`scripts/isolated-unit-tests.json`)**:
   - Contains ~36 specific test files that mutate process-global state, spawn long-lived child processes (like stdio MCP servers or real shells), use top-level `mock.module()`, or alter singletons like `settingsManager`.
   - Each file in this manifest is executed in a **fresh, dedicated Bun child process** with explicit per-test timeouts (15s to 30s) and custom environment flags (such as `LETTA_SKIP_KEYCHAIN_CHECK="1"`).
2. **Shared Process Batches**:
   - The remaining ~700+ stateless tests run in bounded batches.
   - Files are partitioned using `chunkByCommandLength(files, maxChars = 20000)`. This guarantees that command arguments remain well under the 32k character limit of Windows `CreateProcess` and standard POSIX shell limits.

---

## 2. Test Utilities and Helpers

`letta-code` includes dedicated test utilities in `scripts/` and `src/test-utils/` to ensure deterministic execution without modifying operator state.

### 2.1 Test Home Preload Sandboxing (`scripts/test-home-preload.ts`)

Configured in `bunfig.toml` via `[test] preload = ["./scripts/test-home-preload.ts"]`, this script executes automatically before any test file runs in Bun:

1. **Operating System Module Patching**:
   Bun resolves `os.homedir()` before standard preloads run. The preload directly monkey-patches the Node.js `os` built-in module:
   ```typescript
   os.homedir = () => testHome;
   ```
   This is a direct module override rather than a Bun mock, ensuring that subsequent `mock.restore()` calls in user tests cannot undo the filesystem sandbox.
2. **Disposable Temporary Directory**:
   Creates a dedicated temporary directory (`mkdtempSync(join(os.tmpdir(), "letta-code-test-home-"))`). It verifies that `testHome !== originalHome` and raises a fatal exception if an operator's real home directory is targeted.
3. **Environment Variable Redirection**:
   Scans and redirects all known filesystem environment variables away from the user's home into the test directory:
   `LETTA_ARTIFACTS_DIR`, `LETTA_CODE_DEV_BACKEND_DIR`, `LETTA_DEBUG_FILE`, `LETTA_HOME`, `LETTA_LOCAL_BACKEND_DIR`, `LETTA_MEMORY_DIR`, `LETTA_TRANSCRIPT_ROOT`, `XDG_CONFIG_HOME`, etc.
4. **Keychain & Telemetry Isolation**:
   - Sets `process.env.LETTA_TEST_SECRETS_SERVICE_PREFIX = "letta-code-test-<pid>-<testHome>"`.
   - Defaults `process.env.LETTA_CODE_TELEM = "0"` to prevent test executions from sending product telemetry.
5. **Automatic Teardown**:
   Hooks `afterAll()` and `process.once("exit")` to recursively delete the temporary home directory unless an explicit `LETTA_TEST_HOME` was supplied externally.

### 2.2 Filesystem Fixture Helper (`src/test-utils/test-fs.ts`)

Encapsulates filesystem lifecycle management for tool and workspace tests:

```typescript
export class TestDirectory {
  public readonly path: string;
  constructor() {
    this.path = mkdtempSync(join(tmpdir(), "letta-test-"));
  }
  createFile(relativePath: string, content: string): string;
  createBinaryFile(relativePath: string, buffer: Buffer): string;
  createDir(relativePath: string): string;
  resolve(relativePath: string): string;
  cleanup(): void;
}
```

### 2.3 Environment Sandboxing (`src/test-utils/test-process-env.ts`)

Provides utilities to strip ambient environment variables that might leak from the developer's shell or parent CI processes:
- `AMBIENT_LETTA_TEST_ENV_KEYS`: Explicit list of 20 sensitive keys (`LETTA_API_KEY`, `LETTA_AGENT_ID`, `CONVERSATION_ID`, `LETTA_LOCAL_BACKEND_DIR`, `LETTA_CODE_DEV_PI_MODEL`, etc.).
- `stripAmbientLettaTestEnv(env)`: Purges all matching keys from the environment object.
- `createIsolatedCliTestEnv(extraEnv)`: Produces a clean environment object with session persistence and autoupdater disabled (`LETTA_DISABLE_SESSION_PERSIST=1`, `DISABLE_AUTOUPDATER=1`).
- `isolateAmbientLettaTestEnv(extraEnv)`: Snapshots `process.env`, strips ambient variables, applies overrides, and returns a cleanup function to restore the snapshot in `afterEach()`.

### 2.4 In-Memory Runtime Model Catalog Fixtures (`src/test-utils/runtime-model-catalog.ts`)

Allows model-selection tests to run deterministically against a static fixture without network calls:
- Backed by `src/test-utils/fixtures/runtime-model-catalog.json`.
- `setupRuntimeModelCatalogFixture()`: Bundles `beforeEach` and `afterEach` hooks that splice catalog models directly into the shared in-memory `models` array and restore it afterwards.

### 2.5 Terminal UI (Ink / React) Test Harness

Testing interactive Ink terminal components requires capturing ANSI terminal streams without opening a real TTY. `letta-code` achieves this with a virtual stream harness:

```typescript
class CaptureStream extends Writable {
  columns = 100;
  rows = 24;
  isTTY = true;
  chunks: string[] = [];
  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void) {
    this.chunks.push(String(chunk));
    callback();
  }
}

function createInputStream(): NodeJS.ReadStream {
  const input = new Readable({ read() {} }) as NodeJS.ReadStream;
  input.isTTY = true;
  input.setRawMode = () => input;
  return input;
}
```

Tests render the component to the `CaptureStream`, wait for the React rendering cycle (`await new Promise(r => setTimeout(r, 20))`), unmount the instance, and assert on the output after passing it through `stripAnsi()`.

### 2.6 Scoped Runtime Context via `AsyncLocalStorage` (`src/runtime-context.ts`)

Rather than mutating global state or passing context objects through every layer, `letta-code` uses Node's `AsyncLocalStorage` to hold turn-level metadata (`agentId`, `workingDirectory`, `permissionMode`, `workspaceSandbox`):

```typescript
export function runWithRuntimeContext<T>(
  snapshot: RuntimeContextSnapshot,
  fn: () => T,
): T
```

In tests, any tool execution or command handler can be cleanly wrapped in `runWithRuntimeContext({ agentId: "test-agent", workingDirectory: tempDir }, () => ...)` without altering process-level globals.

---

## 3. Mocking Patterns and Isolation Governance

Mocking in `letta-code` is governed by strict architectural rules designed to prevent **test pollution in Bun's shared module cache**.

### 3.1 The Problem: Process-Global Module Mocks in Bun

In Bun, calling `mock.module()` modifies the global module registry for the entire worker process. If test `A.test.ts` mocks `@/backend/api/client` and does not properly restore it, or if it runs in the same worker as `B.test.ts`, the mock silently affects `B.test.ts`. This causes "ghost failures" that pass when run individually but fail during `bun test`.

### 3.2 Automated Mock Isolation Checker (`scripts/check-test-mock-isolation.js`)

To prevent mock leakage, `letta-code` runs an AST/regex linter during `bun run check` and CI:

1. **Mandatory Restore Hook**:
   Every test file containing `mock.module(...)` **must** declare a top-level `afterEach` or `afterAll` hook calling `mock.restore()`. Tests without this hook are rejected with:
   `"missing: top-level afterEach/afterAll mock.restore() hook"`
2. **Forbidden Shared Module Mocks (`FORBIDDEN_MOCK_MODULES`)**:
   Certain core architectural singletons must **never** be replaced with `mock.module()`:
   - `/channels/config`: Must use `__testOverrideChannelsRoot()` instead of replacing the configuration module.
   - `/agent/context`: Must use explicit context override seams instead of replacing agent context.
   - `/runtime-context`: Must use `RuntimeContextSnapshot` builders via `runWithRuntimeContext()`.
   - `/settings-manager`: Must use temporary settings files or `settingsManager.reset()`.
3. **Complete Export Verification (`COMPLETE_EXPORT_MOCK_MODULES`)**:
   When mocking runtime modules (e.g. `/channels/slack/runtime`, `/channels/telegram/runtime`), the mock object **must provide every export** declared in the source file. Partial mocks are rejected to prevent later tests from failing with missing ESM export errors.
4. **Top-Level Internal Mock Registration**:
   Any test that executes `mock.module()` at the module top level (outside of `beforeEach`/`test`) against an internal module must be explicitly registered in `scripts/isolated-unit-tests.json` so it runs in an isolated OS process.

### 3.3 Explicit Test Override Seams (Dependency Injection Pattern)

Instead of monkey-patching modules, core services export dedicated test override functions (prefixed with `__test` or suffixed with `ForTests`):

```typescript
// Backend client override
export function __testOverrideGetClient(factory: (() => Promise<unknown>) | null): void;

// Backend instance switch
export function __testSetBackend(backend: Backend | null): void;

// Channels root directory override
export function __testOverrideChannelsRoot(root: string | null): void;

// Credentials store mode override
export function __setChannelCredentialsStoreModeForTests(mode: ChannelCredentialsStoreMode): void;
```

This ensures that overrides are typed, explicit, and easy to reset in `afterEach()` teardowns.

### 3.4 LLM and API Mocking Strategy

Depending on the test tier, LLM interactions are handled via three distinct mechanisms:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Contract / Source-Level Testing                                     │
│    - Verifies header propagation, regex options, and AST parameters    │
│    - Zero network, zero LLM mock pollution                            │
├────────────────────────────────────────────────────────────────────────┤
│ 2. Stubbed Backend API Client                                          │
│    - mock.module("@/backend/api/client", () => ({ ... }))              │
│    - Returns deterministic JSON structures, tool call payloads         │
├────────────────────────────────────────────────────────────────────────┤
│ 3. In-Process Deterministic Executor                                   │
│    - LETTA_LOCAL_BACKEND_EXECUTOR=deterministic                        │
│    - Emulates step progression without real model inference            │
├────────────────────────────────────────────────────────────────────────┤
│ 4. Live Scenarios (API-Gated in CI)                                    │
│    - Cloud providers: OpenAI, Anthropic, Gemini                        │
│    - Local CPU inference: Ollama (qwen2.5:1.5b)                        │
└────────────────────────────────────────────────────────────────────────┘
```

#### Contract / Source-Level Tests
For critical communication contracts (such as multi-user sandbox header propagation in `src/agent/send-message-stream-acting-user.test.ts`), tests inspect source code files via `readFileSync` and verify AST declarations and regex matches. This pins HTTP header formatting and option propagation without spawning backend mocks that could pollute other suites.

#### Deterministic Executor
The local in-process backend supports `LETTA_LOCAL_BACKEND_EXECUTOR=deterministic`. When active, it short-circuits LLM calls and returns scripted tool invocations, allowing testing of complex agent loops without external API costs or latency.

---

## 4. Coverage Approach, Impact Analysis, and CI Pipeline

Quality verification in `letta-code` operates on a strict "shift-left" principle: checks run on staged files during pre-commit, run selectively based on file impact during pull requests, and execute across a multi-platform matrix in continuous integration.

### 4.1 Automated Pre-Commit Enforcement (`.husky/pre-commit`)

Git commits trigger an automated verification chain via Husky:
1. **Ban Relative Parent Imports**: Inspects staged TypeScript files and rejects any `../` imports, requiring the `@/` path alias.
2. **Circular Dependency Check**: Runs `madge --circular --extensions ts,tsx src/`.
3. **Layer Boundary Verification**: Enforces import hierarchies (`scripts/check-layer-boundaries.js`).
4. **Function Style Check**: Flags exported arrow functions in `.ts` files, enforcing `export function` declarations (`scripts/check-exported-functions.js`).
5. **Filename Casing**: Enforces kebab-case file naming (`scripts/check-filename-casing.js --staged`).
6. **File Size Ratchet**: Enforces a strict 1,000-line ceiling on all source and test files (`scripts/check-source-file-size.js`).
7. **Module Ownership**: Prevents orchestration files from becoming indiscriminate barrel exports (`scripts/check-module-ownership.js`).
8. **Skill Metadata Validation**: Verifies YAML frontmatter on all bundled skills (`scripts/check-skill-frontmatter.js --staged`).
9. **Biome Linter**: Runs `lint-staged` with `@biomejs/biome check --write`.
10. **Full Typecheck**: Executes `tsc --noEmit` across the entire project.

### 4.2 Architectural Check Suite (`bun run check`)

The repository aggregates 12 deterministic health checks into `scripts/check.js`:

```text
[1/12]  circular dependencies ......... PASS  0.4s  (342 files)
[2/12]  layer boundaries .............. PASS  0.1s
[3/12]  exported function style ....... PASS  0.2s
[4/12]  filename casing ............... PASS  0.1s
[5/12]  source file size .............. PASS  0.1s
[6/12]  module ownership .............. PASS  0.1s
[7/12]  test mock isolation ........... PASS  0.3s
[8/12]  test coverage ................. PASS  0.1s  (751 files)
[9/12]  skill frontmatter ............. PASS  0.1s
[10/12] bundled skill scripts ......... PASS  0.1s
[11/12] biome ......................... PASS  0.3s
[12/12] typescript .................... PASS  2.1s
✓ 12 checks passed in 3.9s
```

### 4.3 Test Coverage Guard (`scripts/check-test-coverage.cjs`)

Unlike traditional line-coverage percentage thresholds (e.g. 80%), `letta-code` enforces **Directory Test Coverage Governance**:
- Recursively crawls `src/` to collect all `*.test.ts` and `*.test.tsx` files.
- Ensures that every test belongs to an explicitly covered directory listed in `scripts/run-unit-tests.cjs` or `specialDirs`.
- If a developer creates a new top-level module under `src/` (e.g. `src/auth-v2/`) with tests but forgets to register it in `run-unit-tests.cjs`, `check-test-coverage` fails immediately, preventing silently orphaned tests in CI.

### 4.4 Family-Based Test Impact Analysis (`scripts/unit-test-impact.cjs`)

Running all 750+ tests on every PR commit adds significant CI overhead. `letta-code` includes a custom impact analyzer:
1. **TypeScript AST Dependency Mapping**:
   Uses TypeScript's compiler API (`ts.createSourceFile`, `ts.resolveModuleName`) to build a dependency index mapping source files to their test families (`src/agent`, `src/cli`, `src/tools`, etc.).
2. **Pull Request File Classification**:
   - Compares Git diff (`--base` and `--head` or GitHub PR metadata).
   - Non-code files (`README.md`, `LICENSE`, assets, docs) trigger **zero unit tests**.
   - Core root files (`package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`, `ci.yml`) trigger the **full test suite**.
   - Changes to specific domain modules trigger only tests in that family and immediate local dependents.

### 4.5 Continuous Integration Workflow Matrix (`.github/workflows/ci.yml`)

The GitHub Actions pipeline is structured to fail fast while providing broad platform coverage:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. classify: Detects chore(release) bumps to skip heavy CI             │
├────────────────────────────────────────────────────────────────────────┤
│ 2. check: Runs 12 validation scripts on Ubuntu runner                  │
├────────────────────────────────────────────────────────────────────────┤
│ 3. update-chain-smoke: Validates manual update chain                   │
├────────────────────────────────────────────────────────────────────────┤
│ 4. build (Multi-Platform Matrix):                                      │
│    ├── macOS arm64 (macos-14)                                          │
│    ├── Linux x64 (ubuntu-24.04)                                        │
│    ├── Linux arm64 (ubuntu-24.04-arm)                                  │
│    └── Windows x64 (windows-latest)                                    │
│    Steps:                                                              │
│      • Verify native binaries (sharp, node-pty)                        │
│      • Unlock GNOME Keyring (Linux)                                    │
│      • Run unit tests (run-unit-tests.cjs with 15m timeout)            │
│      • Run API integration tests (src/integration-tests/)              │
│      • Build standalone bundle (bun run build)                         │
│      • Bundle size audit (warn if > 50MB)                              │
│      • Test npm install flow (PowerShell on Win, sh on Unix)           │
│      • Headless CLI smoke test (./letta.js --prompt "ping")            │
│      • Windows headless integration test (headless-windows.ts)         │
├────────────────────────────────────────────────────────────────────────┤
│ 5. node18-smoke: Verifies bundled CLI on Node 18                       │
├────────────────────────────────────────────────────────────────────────┤
│ 6. headless & headless-local: Multi-model live inference scenarios     │
│    • Models: gpt-5.4-mini-medium, sonnet-4.6-low, haiku, gemini-3.6    │
│    • Output formats: text, json, stream-json                           │
├────────────────────────────────────────────────────────────────────────┤
│ 7. ollama-smoke: Installs Ollama, pulls qwen2.5:1.5b, tests CPU run    │
├────────────────────────────────────────────────────────────────────────┤
│ 8. reflection-headless: Headless reflection scenario                   │
├────────────────────────────────────────────────────────────────────────┤
│ 9. docker: Runs letta/letta:latest container & tests CLI against it    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Key Architectural Lessons & Takeaways

1. **Bun Module Mocking Requires Strict Process Isolation**:
   Because `mock.module()` affects the global worker process in Bun, large codebases cannot rely on standard `afterEach` cleanup alone when mutating shared singletons or top-level module graphs. Isolating stateful suites into dedicated OS child processes (`isolated-unit-tests.json`) while batching stateless tests provides both speed and stability.
2. **Static Architecture Checkers Outperform Slow Runtime Tests**:
   By using fast AST scripts (`scripts/check-*.js`) to enforce layer boundaries, file sizes, export styles, and mock isolation, `letta-code` catches architectural rot in sub-second pre-commit hooks rather than during multi-minute CI test runs.
3. **Environment and Directory Sandboxing Must Be Preloaded**:
   Patching `os.homedir()` in a global test preload (`scripts/test-home-preload.ts`) guarantees that neither buggy tests nor misconfigured tools can ever read or corrupt the developer's real `~/.letta` directory or system keychain.
4. **Prefer Explicit Test Overrides Over Module Monkey-Patching**:
   Explicit seams (e.g. `__testOverrideGetClient`, `__testSetBackend`) combined with `AsyncLocalStorage` (`runWithRuntimeContext`) eliminate the need for brittle global module mocks across most domain tests.
5. **Multi-Platform Native Bindings Require Real OS Runners**:
   Libraries with native C++/Rust bindings (`node-pty`, `sharp`) cannot be verified through mocks alone. Running matrix builds across macOS arm64, Linux x64, Linux arm64, and Windows x64 in CI prevents platform-specific crashes from reaching users.
