# Letta Code API Surface & Architecture Specification

**Document Version:** `2026-09-03.0630`  
**Package:** `@letta-ai/letta-code` (`v0.31.6`)  
**Commit:** `2823362103cc9abadc10fff3e6ea9c8a6ca3946b`  
**Study Mode:** Read-only architectural inspection of upstream canonical source (`letta-ai/letta-code`)

---

## 1. Executive Summary & Architectural Overview

Letta Code is a dual-paradigm autonomous agent runtime engineered by Letta AI. While outwardly presented as a terminal coding assistant, its underlying implementation is a distributed, modular agent platform that operates across multiple execution environments:

1. **CLI / Terminal User Interface (TUI):** A terminal-native client powered by React/Ink and Node-PTY.
2. **Headless Agent Engine:** A scriptable background daemon streaming structured JSON lines (`stream-json`) over standard streams.
3. **AppServer WebSocket Gateway:** A multi-tenant, bi-directional WebSocket server allowing desktop applications (such as Letta Desktop), web clients, and external processes to manage agent runtimes, interactive approval dialogs, and workspace files.
4. **OpenAI Compatibility Bridge:** A built-in HTTP server exposing `/v1/models`, `/v1/chat/completions`, and `/v1/responses` endpoints, allowing any standard OpenAI SDK or client to communicate directly with stateful Letta agents.
5. **Mod & Skill Extension Fabric:** A runtime plugin layer featuring local user mods, Claude Code-compatible lifecycle hooks, and progressive-disclosure skills.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                 Letta Code Hosts                                 │
│                                                                                  │
│   CLI / TUI (Ink)        Letta Desktop (Electron)      Third-Party Services/SDKs │
└─────────┬───────────────────────────┬───────────────────────────────┬────────────┘
          │                           │                               │
          │ [STDIN/STDOUT]            │ [WebSocket Protocol V2]       │ [OpenAI REST / WS]
          ▼                           ▼                               ▼
┌───────────────────┐       ┌──────────────────────────────────────────────────────┐
│  Headless Runner  │       │             AppServer Gateway Engine                 │
│   (headless.ts)   │       │               (src/websocket/)                       │
└─────────┬─────────┘       └───────────────────────┬──────────────────────────────┘
          │                                         │
          └────────────────────┬────────────────────┘
                               ▼
        ┌───────────────────────────────────────────────────────┐
        │                 Core Agent Runtime                    │
        │    (Context, Models, Memory-FS, Tools, Subagents)     │
        └──────────────┬─────────────────────────┬──────────────┘
                       │                         │
       ┌───────────────┴──────────┐   ┌──────────┴────────────────┐
       ▼                          ▼   ▼                           ▼
┌──────────────┐     ┌──────────────┐ ┌──────────────┐    ┌───────────────┐
│ Mod Engine   │     │ Hooks Engine │ │ Skill System │    │  MCP Client   │
│ (~/.letta/   │     │ (Pre/Post    │ │ (.agents/    │    │ (stdio/http/  │
│  mods/)      │     │  ToolUse)    │ │  skills/)    │    │  sse + OAuth) │
└──────────────┘     └──────────────┘ └──────────────┘    └───────────────┘
```

---

## 2. Public API Surface & Package Exports

The package `package.json` declares a clean, dual-environment export boundary designed for Node.js servers, desktop Electron wrappers, and browser-safe web frontends.

### 2.1 Package Export Map

| Export Path | Typings File | Runtime Target | Description |
| :--- | :--- | :--- | :--- |
| `.` | `dist/types/index.d.ts` | Node.js (ESM) | Standalone executable binary (`letta.js`). |
| `./app-server-client` | `dist/types/app-server-client.d.ts` | Browser / ESM / CJS | Client library for connecting to the AppServer WebSocket daemon. |
| `./app-server-protocol` | `dist/types/types/app-server-protocol.d.ts` | Universal | Full wire protocol union for AppServer request/response frames. |
| `./protocol` | `dist/types/types/protocol.d.ts` | Universal | Legacy V1 streaming JSON envelope and event types. |
| `./memory-confinement` | `dist/types/memory-confinement.d.ts` | Node.js (ESM) | Sandbox isolation wrapper for unattended subagent processes. |
| `./mcp-client` | `dist/types/mcp-client.d.ts` | Node.js (ESM) | Universal Model Context Protocol (MCP) client supporting stdio, http, and sse. |
| `./agent-presets` | `dist/types/agent-presets.d.ts` | Browser / ESM | Browser-safe agent creation factory, personality templates, and tags. |
| `./schedules` | `dist/types/schedules.d.ts` | Browser / ESM | Pure envelope contract for scheduled cron turns and transcript parsing. |
| `./channels` | `dist/types/channels-public.d.ts` | Browser / ESM | Public messaging channel interfaces, routers, and progress builders. |
| `./gateway-core` | `dist/types/gateway-core.d.ts` | Browser / ESM | Ingress coordinator and message delivery broker for channel platforms. |
| `./channels/slack` | `dist/types/channels-slack.d.ts` | Browser / ESM | Platform primitives for Slack ingress, blocks, and interactive modals. |
| `./channels/telegram` | `dist/types/channels-telegram.d.ts` | Browser / ESM | Platform primitives for Telegram debounce, entities, and rich formatting. |

---

### 2.2 Deep Dive: `./app-server-client`

The primary integration vehicle for external host applications (such as desktop frontends and web companions) is `AppServerClient`, exported from `./app-server-client`.

#### Core Signatures & Options

```typescript
export type AppServerClientOptions = {
  /** Base app-server URL, e.g. ws://127.0.0.1:4500 or http://127.0.0.1:4500 */
  url: string;
  /** Optional capability token sent as Authorization: Bearer <token> */
  authToken?: string;
  /** Custom WebSocket constructor (required in Node.js environments) */
  WebSocket?: AppServerSocketConstructor;
  /** Timeout for request-response correlation in ms (default: 30,000) */
  requestTimeoutMs?: number;
};

export class AppServerClient {
  readonly socket: AppServerSocketLike;
  
  constructor(options: AppServerClientOptions);
  
  connect(): Promise<this>;
  close(): void;
  
  // Event registration
  onMessage(handler: AppServerMessageHandler): () => void;
  onSend(handler: AppServerSendHandler): () => void;
  onDisconnect(handler: AppServerDisconnectHandler): () => void;
  onExternalToolCall(handler: AppServerExternalToolCallHandler): () => void;
  
  // High-level typed commands
  info(options?: AppServerRequestOptions<AppServerInfoResponseMessage>): Promise<AppServerInfoResponseMessage>;
  runtimeStart(command: RuntimeStartCommandInput, options?: AppServerRequestOptions<RuntimeStartResponseMessage>): Promise<RuntimeStartResponseMessage>;
  runtimeExternalToolsUpdate(command: RuntimeExternalToolsUpdateCommandInput): Promise<RuntimeExternalToolsUpdateResponseMessage>;
  sync(command: SyncCommandInput): Promise<SyncResponseMessage>;
  abort(command: AbortMessageCommandInput): Promise<AbortMessageResponseMessage>;
  conversationList(command?: ConversationListCommandInput): Promise<ConversationListResponseMessage>;
  
  // Input dispatching
  input(command: Omit<InputCommand, "type">): void;
  submitInput(command: SubmitInputCommandInput): Promise<InputAcceptedResponseMessage>;
  
  // Low-level request matching
  request<TMessage extends WsProtocolMessage = WsProtocolMessage>(
    command: AppServerRequestCommandWithId,
    options?: AppServerRequestOptions<TMessage>,
  ): Promise<TMessage>;
  sendRaw(command: AppServerRawCommand): void;
  requestRaw<TResponse extends AppServerRawResponse>(
    command: AppServerRawCommand & { request_id: string },
    options: AppServerRawRequestOptions<TResponse>,
  ): Promise<TResponse>;
}

export function createAppServerClient(options: AppServerClientOptions): AppServerClient;
```

#### Key Protocol Flow

1. **Connection & Handshake:** The client connects to `ws://host:port/ws`. Handshake authentication uses `Authorization: Bearer <token>`.
2. **Correlation Matching:** Outgoing requests contain a generated `request_id`. The client holds a pending `Map<string, PendingRequest>` with individual timeouts. Inbound messages with matching `request_id` resolve the respective promise.
3. **External Tool Execution:** When the model calls a client-registered external tool, the server issues an `external_tool_call_request`. `AppServerClient.onExternalToolCall` invokes the registered callback and dispatches `external_tool_call_response` back through the socket.

---

### 2.3 Deep Dive: Protocol Types (`./protocol` and `./protocol_v2`)

The codebase contains two tiers of protocol definitions:

#### Legacy Wire Protocol (`./protocol`)
Emitted by `src/headless.ts` in `--stream-json` mode. All lines follow the base `MessageEnvelope`:

```typescript
export type MessageEnvelope = {
  session_id: string;
  uuid: string;
  timestamp?: string; // ISO 8601 UTC stamped at serialization
  event_seq?: number; // Monotonic sequence number
  agent_id?: string | null;
  conversation_id?: string;
};
```

Message subtypes include `SystemInitMessage`, `AssistantMessage`, `ToolCallMessage`, `ToolReturnMessage`, `ReasoningMessage`, `ApprovalRequestMessage`, `ApprovalResponseMessage`, and `DoneMessage`.

#### Protocol V2 (`./protocol_v2` / `./app-server-protocol`)
A runtime-scoped, bi-directional contract containing:
- **`WsProtocolCommand`:** Over 80 strongly typed commands, including `InputCommand`, `AbortMessageCommand`, `SyncCommand`, `RuntimeStartCommand`, file operations (`ReadFileCommand`, `EditFileCommand`), memory operations (`ListMemoryCommand`, `ReadMemoryFileCommand`, `WriteMemoryFileCommand`), model configuration (`UpdateModelCommand`, `ListModelsCommand`), terminal operations (`TerminalSpawnCommand`, `TerminalInputCommand`), and channel routing (`ChannelStartCommand`, `ChannelAccountCreateCommand`).
- **`WsProtocolMessage`:** Over 70 inbound notification and response events, including `StreamDeltaMessage`, `TurnFinishedMessage`, `LoopStatusUpdateMessage`, `QueueUpdateMessage`, `SubagentStateUpdateMessage`, and `ExternalToolCallRequestMessage`.

---

### 2.4 Deep Dive: `./mcp-client`

Letta Code implements client-side MCP (Model Context Protocol) integration adhering to SDK `1.30.0`. It abstracts transport complexity into a clean interface:

```typescript
export type StdioMcpServerConfig = {
  name: string;
  transport?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type HttpMcpServerConfig = {
  name: string;
  transport: "http";
  url: string;
  headers?: Record<string, string>;
};

export type SseMcpServerConfig = {
  name: string;
  transport: "sse";
  url: string;
  headers?: Record<string, string>;
};

export type McpServerConfig = StdioMcpServerConfig | HttpMcpServerConfig | SseMcpServerConfig;

export type ConnectedMcpServer = {
  name: string;
  tools: McpToolDefinition[];
  callTool(
    name: string,
    args?: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<McpToolResult>;
  close(): Promise<void>;
};

export function connectMcpServer(
  config: McpServerConfig,
  options?: ConnectMcpServerOptions,
): Promise<ConnectedMcpServer>;
```

Notable feature: Automatic OAuth 2.0 re-authentication when connecting to remote HTTP/SSE endpoints returning HTTP 401 Unauthorized (`UnauthorizedError`).

---

### 2.5 Deep Dive: `./agent-presets`

This entry point allows browser-safe creation of Letta Code agents with identical configurations (tags, base tools, system prompts, memory templates) as the CLI:

- **`buildCreateAgentRequest(options)`:** Constructs the JSON body for Letta Core `/v1/agents` API.
- **`buildCreatedAgentTags(options)`:** Generates standardized tags:
  - `letta_code_origin`: Identifies agent origin.
  - `git_memory_enabled`: Flags MemFS support.
  - `personality:<id>`: Binds personality profile.
  - `onboarding_origin`: Marks onboarding state.
- **Personalities:** Preconfigured presets (`default`, `kawaii`, `linus`, `memo`, `tutorial`, `blank`) with tailored prompt guidelines and starter memory documents (`system/persona.md`, `system/human/identity.md`).

---

## 3. Extension Points, Lifecycle Hooks & Event Architecture

Letta Code provides two complementary extension mechanisms:
1. **Lifecycle Hooks System (`src/hooks/`):** A Claude Code-compatible shell/prompt hook system configured in JSON.
2. **Mod System Event Fabric (`src/mods/`):** An in-process TypeScript/JavaScript plugin architecture.

---

### 3.1 Claude Code-Compatible Lifecycle Hooks

Hooks are configured in `~/.letta/settings.json` (global), `<project>/.letta/settings.json` (project-shared), or `<project>/.letta/settings.local.json` (untracked local).

#### Event Taxonomy

```typescript
// Tool-scoped events (require tool name matchers)
export type ToolHookEvent =
  | "PreToolUse"          // Intercepts tool call before execution (can block or mutate arguments)
  | "PostToolUse"         // Fires after tool returns (observes output and reasoning)
  | "PostToolUseFailure"  // Fires when tool execution throws (feeds stderr back to model)
  | "PermissionRequest";  // Fires on permission dialog display (can auto-allow or deny)

// Session and lifecycle events
export type SimpleHookEvent =
  | "UserPromptSubmit"    // Fires when user submits prompt (can block prompt submission)
  | "Notification"        // Fires when system notification is dispatched
  | "Stop"                // Fires when agent turn concludes (can force turn continuation)
  | "SubagentStop"        // Fires when subagent finishes execution
  | "PreCompact"          // Fires before context window compaction occurs
  | "SessionStart"        // Fires when session initializes or resumes
  | "SessionEnd";         // Fires when session terminates
```

#### Hook Execution Modes

1. **Command Hooks (`CommandHookConfig`):**
   - Executes a local shell binary via `node:child_process` / `cross-spawn`.
   - Passes hook input JSON via standard input (`stdin`).
   - Evaluates process exit code:
     - `0` (`HookExitCode.ALLOW`): Proceed normally.
     - `1` (`HookExitCode.ERROR`): Non-fatal warning or error reported.
     - `2` (`HookExitCode.BLOCK`): Reject or block the operation; `stdout` is fed back as the rejection reason.
   - For `PreToolUse`, a hook outputting JSON containing `{"updatedInput": {...}}` rewrites tool arguments dynamically before execution.

2. **Prompt Hooks (`PromptHookConfig`):**
   - Dispatches a verification prompt to an auxiliary LLM with `$ARGUMENTS` interpolated with input data.
   - Evaluates structured model response:
     ```json
     {
       "ok": false,
       "reason": "Forbidden command pattern detected"
     }
     ```

---

### 3.2 Mod Event Fabric & In-Process Interceptors

Unlike external hook processes, mods run directly inside the Node/Bun runtime, registering zero-overhead event callbacks:

```typescript
export type ModEventName =
  | "conversation_open"   // Session initialization, resumption, or fork
  | "conversation_close"  // Teardown or switch
  | "turn_start"          // User input received; can mutate input or cancel turn
  | "turn_end"            // Turn finished; can request agent continuation
  | "tool_start"          // Intercept tool args or short-circuit execution
  | "tool_end"            // Inspect or replace tool return output
  | "compact_start"       // Context overflow compaction began
  | "compact_end"         // Compaction completed
  | "llm_start"           // LLM API request dispatched
  | "llm_end";            // LLM API completed, tokens consumed, or error occurred
```

#### Interceptor Powers in Practice

- **Turn Cancellation (`turn_start`):**
  ```typescript
  letta.events.on("turn_start", (event) => {
    if (isBlockedWorkHour()) {
      return { cancel: { reason: "Automated work forbidden during blackout window." } };
    }
  });
  ```
- **Tool Result Short-Circuiting (`tool_start`):**
  ```typescript
  letta.events.on("tool_start", (event) => {
    if (event.toolName === "Bash" && isCachedCommand(event.args.command)) {
      return {
        result: { status: "success", output: getCachedResult(event.args.command) }
      };
    }
  });
  ```
- **Autonomous Turn Continuation (`turn_end`):**
  ```typescript
  letta.events.on("turn_end", (event) => {
    if (hasPendingVerificationSteps()) {
      return { continue: "Verification remaining: Run test suite to verify patch." };
    }
  });
  ```

---

## 4. Integration Patterns

Letta Code offers four distinct integration patterns for third-party tools, IDE extensions, CI pipelines, and service orchestrators.

---

### 4.1 Pattern A: Headless Subprocess Integration (CLI Pipeline)

In automated environments or scripting pipelines, Letta Code runs as an isolated subprocess emitting newline-delimited JSON.

```bash
letta --prompt "Analyze src/auth/ and write security checklist" --stream-json
```

#### Input/Output Protocols
- **Invocation Flags:**
  - `--prompt "<text>"`: Single-turn non-interactive instruction.
  - `--stream-json`: Formats standard output as single-line JSON envelopes.
  - `--permission-mode <mode>`: Sets authorization policy (`standard`, `acceptEdits`, `unrestricted`, `strict`).
  - `--toolset <toolset>`: Selects toolset (`default`, `codex`, `gemini`, `none`).
- **Interactive Control Over Stdin:**
  In streaming mode, stdin remains active to receive JSON-encoded user decisions (such as tool execution approvals) or additional conversation inputs.

---

### 4.2 Pattern B: AppServer WebSocket Gateway

For stateful desktop clients and long-lived IDE sidecars, Letta Code runs an embedded WebSocket server:

```bash
letta app-server --listen ws://127.0.0.1:4500
```

```
┌─────────────────┐                                  ┌───────────────────────┐
│ External Client │                                  │ Letta Code AppServer  │
└────────┬────────┘                                  └───────────┬───────────┘
         │                                                       │
         │ 1. Connect (ws://127.0.0.1:4500/ws)                   │
         ├──────────────────────────────────────────────────────►│
         │                                                       │
         │ 2. RuntimeStartCommand { agent_id, toolset, ... }     │
         ├──────────────────────────────────────────────────────►│
         │◄──────────────────────────────────────────────────────┤
         │    RuntimeStartResponseMessage { runtime_id, ... }    │
         │                                                       │
         │ 3. InputCommand { text: "Fix lint errors" }           │
         ├──────────────────────────────────────────────────────►│
         │◄──────────────────────────────────────────────────────┤
         │    InputAcceptedResponseMessage { request_id }        │
         │◄──────────────────────────────────────────────────────┤
         │    StreamDeltaMessage (token stream...)               │
         │                                                       │
         │ 4. ExternalToolCallRequestMessage { tool, args }      │
         │◄──────────────────────────────────────────────────────┤
         │    (Client performs operation, e.g. UI picker)        │
         │ 5. ExternalToolCallResponseCommand { result }         │
         ├──────────────────────────────────────────────────────►│
         │◄──────────────────────────────────────────────────────┤
         │    TurnFinishedMessage { stop_reason: "end_turn" }    │
```

#### Key Capabilities
1. **Dynamic Toolset Injection:** External clients register host-provided tools via `RuntimeExternalToolsUpdateCommand`. The remote agent invokes these tools seamlessly.
2. **Terminal Multiplexing:** Built-in PTY terminal spawning (`TerminalSpawnCommand`, `TerminalInputCommand`, `TerminalResizeCommand`) enables integrated terminal emulation within client UIs.
3. **MemFS Remote Browsing:** Native wire commands (`ListMemoryCommand`, `ReadMemoryFileCommand`, `WriteMemoryFileCommand`, `MemoryCommitDiffCommand`) allow clients to display and edit Git-backed memory trees remotely.

---

### 4.3 Pattern C: OpenAI-Compatible REST Bridge

The AppServer includes a built-in HTTP adapter (`src/websocket/app-server-openai.ts`) supporting the standard OpenAI API specification:

```bash
letta app-server --listen ws://127.0.0.1:4500 --openai-api
```

#### Supported Endpoints
- `GET /v1/models`: Returns list of active agents and available base models.
- `POST /v1/chat/completions`: Translates standard OpenAI chat completion payloads (messages, model, streaming) into Letta agent conversation turns, streaming back standard SSE chunks (`data: {"choices":[{"delta":{"content":"..."}}]}`).
- `POST /v1/responses`: Implements OpenAI Responses API draft.

This bridge enables tools like `curl`, standard OpenAI Python/TypeScript SDKs, LangChain, or Open WebUI to consume Letta Code without specialized protocol adapters.

---

### 4.4 Pattern D: Channel Gateway Architecture

For persistent messaging environments (Slack, Telegram, Discord), Letta Code provides the `ChannelGateway` architecture (`src/gateway-core.ts` and `src/channels-public.ts`):

1. **Ingress Normalization:** Inbound webhooks/messages from Slack/Telegram are parsed into standardized `InboundChannelMessage` structs with thread keys (`resolveChannelRouteThreadKey`).
2. **Debouncing & Merging:** Rapid consecutive messages from users are batched via `TelegramDebounce` / `SlackDebounce` before turn dispatch.
3. **Turn Progress Streaming:** `ChannelTurnProgressBuilder` converts raw model tokens and tool lifecycle events into Slack status line updates (`assistant_status`) or Telegram message edits.
4. **Interactive Decisions:** If an approval is required, `ChannelControlRequestCoordinator` posts interactive button components into the chat platform, waiting for a user reaction before resolving the execution gate.

---

## 5. Plugin, Middleware & Customization Architecture

Letta Code features four modular layers for customizing agent behavior, prompt context, and runtime capabilities.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Customization Surfaces                            │
├───────────────────────┬──────────────────────┬──────────────────────────────┤
│ 1. Mod System         │ 2. Skill System      │ 3. Prompt Warehouse          │
│    (~/.letta/mods/)   │    (.agents/skills/) │    (src/agent/prompts/)      │
│                       │                      │                              │
│ • Custom Tools        │ • Reusable Guides    │ • Identity (<self>)          │
│ • Custom Slash Cmds   │ • Progressive Load   │ • Memory Format (<memory>)   │
│ • UI Panels & Badges  │ • Shell Scripts      │ • Model Benchmarks           │
│ • Event Interceptors  │ • Frontmatter-driven │ • Persona Presets            │
└───────────────────────┴──────────────────────┴──────────────────────────────┘
```

---

### 5.1 The Mod System (`src/mods/`)

Mods are trusted local TypeScript/JavaScript files that execute directly within the Letta Code process. They live in:
- `~/.letta/mods/*.ts` (global user mods)
- `<project>/.letta/mods/*.ts` (project-specific mods)
- Or custom paths defined by `LETTA_MODS_DIR`.

#### Core Mod Philosophy
As stated in `src/mods/README.md`:
> *"Because the interface is the agent, not a human plugin author, mods do not need to start from a strongly versioned semantic SDK. Mods are trusted local code that the agent can inspect, edit, reload, and repair."*

#### The `LettaModApi` Contract

A mod file exports a default activation function:

```typescript
export default function activate(letta: LettaModApi) {
  // Register custom slash commands
  letta.commands.register({
    id: "git-summary",
    description: "Summarize uncommitted git changes",
    run: async (ctx) => {
      const status = await runGitStatus(ctx.cwd);
      return { type: "prompt", content: `Here is the current git status:\n${status}` };
    },
  });

  // Register custom model-facing tools
  letta.tools.register({
    name: "fetch_internal_metric",
    description: "Retrieve internal team metrics from local dashboard",
    parameters: {
      type: "object",
      properties: { metric_name: { type: "string" } },
      required: ["metric_name"],
    },
    run: async ({ args, signal }) => {
      const data = await queryMetric(args.metric_name, { signal });
      return JSON.stringify(data);
    },
  });

  // Register UI statusline panels
  letta.ui.openPanel({
    id: "team-banner",
    order: 1, // Above input
    render: (ctx) => {
      return ctx.chalk.cyan(`[Org: Engineering] CWD: ${ctx.workspace.currentDir}`);
    },
  });

  // Intercept lifecycle events
  letta.events.on("tool_end", (event, ctx) => {
    if (event.toolName === "Write" && event.status === "success") {
      logAuditTrail(event.args.path);
    }
  });
}
```

#### Mod Diagnostics & Self-Healing
If a mod errors or references an obsolete API, Letta Code logs a structured diagnostic to `.letta/mod-diagnostics.json`:
```json
{
  "owner": { "id": "custom-banner", "path": "/Users/user/.letta/mods/banner.ts" },
  "phase": "activate",
  "severity": "warning",
  "error": "letta.ui.setStatuslineRenderer was removed. Use letta.ui.openPanel({ id, order, render }) instead."
}
```
The agent reads this diagnostic during introspection sessions and autonomously edits the mod file to repair the syntax!

---

### 5.2 The Skill System (`src/skills/` and `.skills/`)

Skills provide on-demand instructions, operational checklists, and executable scripts for specific tasks.

#### 4-Tier Discovery Hierarchy
When an agent or user queries available skills, the runtime scans four directories in descending order of precedence:
1. **Project Skills:** `<project>/.agents/skills/<name>/SKILL.md` (legacy fallback: `<project>/.skills/<name>/SKILL.md`). Overrides all other sources.
2. **Agent Skills:** `~/.letta/agents/<agent-id>/memory/skills/<name>/SKILL.md`. Scoped to a specific persistent agent identity.
3. **Global Skills:** `~/.letta/skills/<name>/SKILL.md`. User-level personal library.
4. **Bundled Skills:** Shipped directly with the package under `skills/` (23 built-in skills, such as `creating-mods`, `initializing-memory`, `syncing-memory-filesystem`, `context-doctor`, etc.).

#### Skill Format & Progressive Disclosure

Every skill is a folder containing a canonical `SKILL.md` file with YAML frontmatter:

```markdown
---
name: Database Migrations
description: Best practices and safety checks for running PostgreSQL schema migrations.
when_to_use: When modifying files in prisma/migrations or running db push/migrate commands.
argument_hint: [migration-name]
disable_model_invocation: false
user_invocable: true
tags: [database, postgres, migration]
---

# Database Migration Guidelines

Before creating a migration:
1. Verify existing schema with `prisma validate`.
2. Check for backward-incompatible column deletions.
...
```

**Context Budget Efficiency:** The runtime does *not* load full `SKILL.md` contents into the system prompt. Instead, it injects a compact XML index:
```xml
<available_skills>
  <skill>
    <name>database-migrations</name>
    <description>Best practices and safety checks for running PostgreSQL schema migrations.</description>
    <when_to_use>When modifying files in prisma/migrations or running db push/migrate commands.</when_to_use>
  </skill>
</available_skills>
```
When the model determines that a task requires a skill, it invokes the built-in `Skill(name="database-migrations")` tool, which reads the file body and returns the detailed instructions directly into the conversation turn.

---

### 5.3 The Prompt Warehouse (`src/agent/prompts/`)

Letta Code organizes system instructions and memory structures as bundled asset files:

#### Key Assets & Variants
- **Core System Prompts:**
  - `letta_no_memfs.md`: Standard system prompt for agents using remote or unconfined memory.
  - `letta_local_memfs.md`: Optimized prompt for agents backed by local Git MemFS (`~/.letta/agents/<id>/memory/`).
  - `letta_root_memfs.md`: Configuration for whole-workspace memory graphs.
- **Benchmarking / Source-Faithful Prompts:**
  - `source_claude.md`: Accurate Claude Code system prompt replication.
  - `source_codex.md`: OpenAI Codex CLI system prompt replication.
  - `source_gemini.md`: Google Gemini CLI system prompt replication.
- **Memory Block Templates:**
  - `persona.mdx`: Identity definition (`<self>`).
  - `human.mdx`: User profile and interaction preferences.
  - `project.mdx`: Repository-level conventions and guidelines.
  - `memory_filesystem.mdx`: Explains directory conventions of Git MemFS to the agent.

---

### 5.4 Persona Customization (`src/agent/personality-presets.ts`)

Personalities dictate the agent's tone, verbosity, and behavioral boundaries.

| Personality ID | Label | Behavioral Characteristics | Key Persona File |
| :--- | :--- | :--- | :--- |
| `default` | Letta Code | Balanced, professional, evidence-focused pair programmer. | `persona.mdx` |
| `kawaii` | Kawaii | Playful, encouraging, expressive assistant using cute emoji and anime tropes. | `persona_kawaii.mdx` |
| `linus` | Linus | Terse, hyper-critical, uncompromising software engineer channeling Linus Torvalds. | `persona_linus.mdx` |
| `memo` | Memo | Ultra-concise, note-style output; minimal conversational filler. | `persona_memo.mdx` |
| `tutorial` | Tutor | Instructive, pedagogical companion guiding junior engineers step-by-step. | `persona_tutorial.mdx` |
| `blank` | Blank | Minimal identity scaffolding; allows full user definition. | `persona_blank.mdx` |

When an agent is created with a persona:
1. `buildCreateAgentRequestForPersonality` seeds initial core memory blocks (`system/persona.md` and `system/human/identity.md`).
2. The agent is tagged with `personality:<id>`.
3. In subsequent turns, prompt compilation reflects this identity inside the `<self>` XML block.

---

## 6. Verification Matrix & Parity Summary

| Architecture Layer | Upstream Canonical (`letta-ai/letta-code`) | Agy Adaptation (`agy-memory-layer`) |
| :--- | :--- | :--- |
| **Memory Isolation** | External Git repository under `~/.letta/agents/<id>/memory/` | External Git repository under `~/.gemini/memory/` |
| **System Projection** | Inlines `system/**/*.md` into `<memory>`, external paths as tree | Inlines committed `system/` owners into prompt context (~1,400 tokens) |
| **Lifecycle Hooks** | Claude Code-compatible JSON hooks (`PreToolUse`, `Stop`, etc.) | Antigravity built-in hooks (`PreInvocation`, `Stop`) |
| **Plugin / Mod Model**| In-process TypeScript mods in `~/.letta/mods/` | Slash command skills (`skills/*/SKILL.md`) + Antigravity plugins |
| **Skill Discovery** | 4-tier discovery (`.agents/skills/`, agent, global, bundled) | Antigravity skill directory discovery |
| **External Integrations**| AppServer WebSocket, OpenAI REST API, MCP, Slack/Telegram | CLI pairwise pair programming, Evidence Controller |
| **Host Toolsets** | `default`, `codex`, `gemini`, `none` | Antigravity built-in toolchain (`view_file`, `write_to_file`, etc.) |

---

## 7. Disconfirmation & Boundary Report

1. **Origin Immutability Check:** The canonical source repository at `.agent-state/learn/letta-ai/letta-code/origin/` remained strictly read-only throughout inspection; zero source files were modified.
2. **Declaration Isolation:** All TypeScript signatures documented herein are derived directly from AST examination of canonical source files and are scoped cleanly to this report.
3. **Evidence Verdict:** **VERIFIED**. The documented API surface is grounded in live source analysis of `letta-ai/letta-code` at commit `2823362103cc9abadc10fff3e6ea9c8a6ca3946b` (v0.31.6).
