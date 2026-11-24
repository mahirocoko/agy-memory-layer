#!/usr/bin/env node

/**
 * Bundled Zero-Dependency MCP Server for agy-memory-layer.
 * Exposes mahiro-pi-compatible root-bound memory tools over stdio JSON-RPC 2.0:
 * - agent_memory_read
 * - agent_memory_edit
 * - agent_memory_commit
 * - agent_memory_manage
 * - agent_memory_reflect
 * - continuity_recall
 *
 * Strict TypeScript `type` aliases only; zero external dependencies.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { isDirectCliInvocation } from './cli-entrypoint.ts'
import {
  commitMemoryDraft,
  editMemory,
  getActiveDraftOverlay,
  getProjectedSharedOverlay,
  type ManageAction,
  MemoryEngineError,
  manageMemory,
} from './memory-engine.ts'
import { reflectMemory } from './memory-reflect.ts'
import { type MemoryReadArgs, readMemory } from './memory-retrieval.ts'
import { MemorySchemaError } from './memory-schema.ts'
import { type RecallSearchMode, searchRecall } from './recall-engine.ts'
import type { ReflectionTrigger } from './reflection-policy.ts'
import { resolveProjectSlug } from './workspace-identity.ts'

export type McpServerContext = {
  memoryRoot?: string
  workspacePath?: string
}

export type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export type McpToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18'])

function readPluginManifest(): { name: string; version: string } {
  try {
    const manifestPath = path.resolve(import.meta.dirname, '..', 'plugin.json')
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      name?: unknown
      version?: unknown
    }
    return {
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : 'agy-memory-layer',
      version: typeof parsed.version === 'string' && parsed.version ? parsed.version : '1.25.1',
    }
  } catch {
    return { name: 'agy-memory-layer', version: '1.25.1' }
  }
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'agent_memory_read',
    description:
      'Read private maintained memory in MemFS (~/.gemini/memory/). Mutually exclusive modes: {} lists authorized files; {path, offset?, limit?} pages a file by Unicode code points or pages a directory newest-first with child index previews; {topic, offset?, limit?} lists namespaces ("", "*", "system", "reference", "projects/<id>"); {query, offset?, limit?} runs bounded Thai/English lexical search with | or OR clauses.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description:
            'Relative memory file or directory path (e.g. "Core.md", "reference", "projects/my-app/system/overview.md").',
        },
        query: {
          type: 'string',
          description:
            'Bounded Thai/English lexical search query (supports | or OR disjunctions, max 256 bytes, max 16 terms).',
        },
        topic: {
          type: 'string',
          description:
            'Namespace selector ("", "*", "system", "system/human", "reference", "procedures", "projects/<id>", etc.).',
        },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 4096 },
        workspace: { type: 'string', description: 'Optional workspace path override.' },
        includeDraft: {
          type: 'boolean',
          description: 'Overlay active uncommitted draft edits when reading (default true).',
        },
      },
    },
  },
  {
    name: 'agent_memory_edit',
    description:
      'Stage or commit an edit in private MemFS (~/.gemini/memory/) with CAS expectedHash, surgical modes (replace, patch, append + optional section), Lossless Retention Guard, read_only protection, and secret scanning. Pass commit: true on single-file edits to auto-sync parent <dir>/index.md + root index.md and commit immediately.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'expectedHash'],
      properties: {
        path: { type: 'string', description: 'Target relative path in MemFS.' },
        expectedHash: {
          type: ['string', 'null'],
          description:
            'Whole-file SHA-256 hash from agent_memory_read, or null when creating a new file.',
        },
        text: {
          type: ['string', 'null'],
          description:
            'Full replacement text (replace), text to append (append), or null to remove a file.',
        },
        mode: {
          type: 'string',
          enum: ['replace', 'patch', 'append'],
          description: 'Edit mode (default replace).',
        },
        oldText: {
          type: 'string',
          description: 'Exact unique substring to replace in patch mode.',
        },
        newText: { type: 'string', description: 'Replacement text for patch mode.' },
        section: { type: 'string', description: 'Optional Markdown heading name for append mode.' },
        commit: {
          type: 'boolean',
          description:
            'When true, auto-syncs <dir>/index.md and root index.md and commits atomically.',
        },
        allowShrink: {
          type: 'boolean',
          description: 'Explicitly allow shrinking a protected system file when justified.',
        },
        message: { type: 'string', description: 'Commit message when commit: true.' },
        draftId: { type: 'string', description: 'Optional draft ID for multi-file drafts.' },
        workspace: { type: 'string', description: 'Optional workspace path override.' },
      },
    },
  },
  {
    name: 'agent_memory_commit',
    description:
      'Atomically commit staged draft edits against base revision with Lossless Retention Guard, read_only guard, and secret scan.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['revision'],
      properties: {
        revision: {
          type: ['string', 'null'],
          description: 'Expected MemFS HEAD commit SHA (or null for initial empty repo).',
        },
        draftId: {
          type: 'string',
          description: 'Optional draft ID (defaults to the sole active draft).',
        },
        message: { type: 'string', description: 'Git commit message.' },
        allowShrink: {
          type: 'boolean',
          description: 'Explicitly allow shrinking protected files when justified.',
        },
        workspace: { type: 'string', description: 'Optional workspace path override.' },
      },
    },
  },
  {
    name: 'agent_memory_manage',
    description:
      'Manage and inspect MemFS: status, doctor (links/indexes/frontmatter/budget audit), palace (JSON structure), palace_export (offline single-file HTML), history (scoped Git log + diffs), init (non-destructive Tiered v2 setup), migrate-v2 (explicit dryRun/apply upgrade), cleanup (discard stale drafts), remember (quick note), policy (get/set reflection policy).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'status',
            'doctor',
            'palace',
            'palace_export',
            'history',
            'init',
            'migrate-v2',
            'cleanup',
            'remember',
            'policy',
          ],
        },
        workspace: { type: 'string' },
        text: { type: 'string', description: 'Note text for remember action.' },
        path: { type: 'string', description: 'Optional target path for remember action.' },
        section: {
          type: 'string',
          description: 'Optional Markdown heading name for remember action.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview init or migrate-v2 without modifying MemFS.',
        },
        outputPath: { type: 'string', description: 'Optional HTML output path for palace_export.' },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 32 },
        trigger: { type: 'string', enum: ['off', 'step-count'] },
        stepCountThreshold: { type: 'integer', minimum: 1, maximum: 100000 },
        model: { type: 'string', description: 'Reflection model ("inherit" or exact model id).' },
      },
    },
  },
  {
    name: 'agent_memory_reflect',
    description:
      'Prepare or run model-flexible Tiered v2 memory reflection. Defaults to mode="plan" (bounded active snapshot + transcript excerpt + curation doctrine for direct agent_memory_edit) or mode="mark_reflected" to reset pending step count, or mode="apply" with explicit confirmation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        assignment: { type: 'string', description: 'Focused reflection goal or topic.' },
        conversationId: {
          type: 'string',
          description: 'Optional Antigravity conversation ID to inspect.',
        },
        mode: {
          type: 'string',
          enum: ['plan', 'apply', 'mark_reflected'],
          description: 'Reflection mode (default: plan).',
        },
        model: {
          type: 'string',
          description: 'Optional model override (defaults to policy/inherited model).',
        },
        maxOperations: { type: 'integer', minimum: 1, maximum: 8 },
        workspace: { type: 'string' },
      },
    },
  },
  {
    name: 'continuity_recall',
    description:
      'Search historical Antigravity conversation transcripts using Hybrid BM25 + subword n-gram similarity. Results are non-binding historical evidence only, never standing policy or current authorization.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        mode: { type: 'string', enum: ['hybrid', 'semantic', 'keyword'] },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
        excludeConversationIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },
]

function resolveDefaults(args: Record<string, unknown>, context: McpServerContext) {
  const memoryRoot =
    context.memoryRoot || process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory')
  const workspacePath =
    (typeof args.workspace === 'string' && args.workspace.trim()) ||
    context.workspacePath ||
    process.env.AGY_WORKSPACE ||
    process.cwd()
  const projectSlug = resolveProjectSlug(workspacePath, memoryRoot)
  return { memoryRoot, workspacePath, projectSlug }
}

type PropertyJsonSchema = {
  type?: string | string[]
  enum?: readonly unknown[]
  minimum?: number
  maximum?: number
  minLength?: number
  items?: { type?: string }
}

function matchesSchemaType(value: unknown, schemaType: string): boolean {
  switch (schemaType) {
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'null':
      return value === null
    case 'array':
      return Array.isArray(value)
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    default:
      return false
  }
}

function assertAllowedToolArgs(toolName: string, rawArgs: unknown): Record<string, unknown> {
  if (
    rawArgs !== undefined &&
    (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs))
  ) {
    throw new MemorySchemaError('INVALID_ARGUMENTS', `${toolName} arguments must be an object.`)
  }
  const args = (rawArgs as Record<string, unknown> | undefined) ?? {}
  const tool = MCP_TOOLS.find((candidate) => candidate.name === toolName)
  if (!tool) {
    throw new MemorySchemaError('INVALID_ARGUMENTS', `Unknown tool: ${toolName}`)
  }
  const schema = tool.inputSchema as {
    required?: readonly string[]
    properties?: Record<string, PropertyJsonSchema>
  }
  const properties = schema.properties ?? {}
  if (Array.isArray(schema.required)) {
    for (const reqKey of schema.required) {
      if (!Object.hasOwn(args, reqKey) || args[reqKey] === undefined) {
        throw new MemorySchemaError(
          'INVALID_ARGUMENTS',
          `${toolName}: missing required argument "${reqKey}".`,
        )
      }
    }
  }
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(properties, key)) {
      throw new MemorySchemaError('INVALID_ARGUMENTS', `${toolName}: unknown argument "${key}".`)
    }
    const value = args[key]
    if (value === undefined) continue
    const prop = properties[key]
    if (!prop) continue
    if (prop.type !== undefined) {
      const allowedTypes = Array.isArray(prop.type) ? prop.type : [prop.type]
      if (!allowedTypes.some((t) => matchesSchemaType(value, t))) {
        throw new MemorySchemaError(
          'INVALID_ARGUMENTS',
          `${toolName}: argument "${key}" must be of type ${allowedTypes.join(' | ')}.`,
        )
      }
    }
    if (Array.isArray(prop.enum) && !prop.enum.includes(value)) {
      throw new MemorySchemaError(
        'INVALID_ARGUMENTS',
        `${toolName}: argument "${key}" must be one of: ${prop.enum.join(', ')}.`,
      )
    }
    if (typeof value === 'string' && typeof prop.minLength === 'number') {
      if (value.length < prop.minLength) {
        throw new MemorySchemaError(
          'INVALID_ARGUMENTS',
          `${toolName}: argument "${key}" must have length >= ${prop.minLength}.`,
        )
      }
    }
    if (typeof value === 'number') {
      if (typeof prop.minimum === 'number' && value < prop.minimum) {
        throw new MemorySchemaError(
          'INVALID_ARGUMENTS',
          `${toolName}: argument "${key}" must be >= ${prop.minimum}.`,
        )
      }
      if (typeof prop.maximum === 'number' && value > prop.maximum) {
        throw new MemorySchemaError(
          'INVALID_ARGUMENTS',
          `${toolName}: argument "${key}" must be <= ${prop.maximum}.`,
        )
      }
    }
    if (Array.isArray(value) && prop.items?.type === 'string') {
      if (value.some((entry) => typeof entry !== 'string')) {
        throw new MemorySchemaError(
          'INVALID_ARGUMENTS',
          `${toolName}: all elements of "${key}" must be strings.`,
        )
      }
    }
  }
  return args
}

async function executeToolCall(
  name: string,
  rawArgs: unknown,
  context: McpServerContext,
): Promise<unknown> {
  const args = assertAllowedToolArgs(name, rawArgs)
  const { memoryRoot, workspacePath, projectSlug } = resolveDefaults(args, context)

  switch (name) {
    case 'agent_memory_read': {
      const readArgs: MemoryReadArgs = {
        ...(args.path !== undefined ? { path: args.path as string } : {}),
        ...(args.query !== undefined ? { query: args.query as string } : {}),
        ...(args.topic !== undefined ? { topic: args.topic as string } : {}),
        ...(args.offset !== undefined ? { offset: args.offset as number } : {}),
        ...(args.limit !== undefined ? { limit: args.limit as number } : {}),
      }
      const includeDraft = args.includeDraft !== false
      const draftOverlay = includeDraft ? getActiveDraftOverlay(memoryRoot) : undefined
      const projectedOverrides = getProjectedSharedOverlay(memoryRoot)
      return readMemory(memoryRoot, readArgs, { draftOverlay, projectedOverrides })
    }

    case 'agent_memory_edit': {
      if (typeof args.path !== 'string') {
        throw new MemorySchemaError('INVALID_ARGUMENTS', 'agent_memory_edit requires string path.')
      }
      if (args.expectedHash !== null && typeof args.expectedHash !== 'string') {
        throw new MemorySchemaError(
          'INVALID_ARGUMENTS',
          'agent_memory_edit requires expectedHash (string or null).',
        )
      }
      return editMemory({
        memoryRoot,
        projectSlug,
        path: args.path,
        expectedHash: args.expectedHash,
        ...(args.text !== undefined ? { text: args.text as string | null } : {}),
        ...(typeof args.mode === 'string'
          ? { mode: args.mode as 'replace' | 'patch' | 'append' }
          : {}),
        ...(typeof args.oldText === 'string' ? { oldText: args.oldText } : {}),
        ...(typeof args.newText === 'string' ? { newText: args.newText } : {}),
        ...(typeof args.section === 'string' ? { section: args.section } : {}),
        ...(typeof args.commit === 'boolean' ? { commit: args.commit } : {}),
        ...(typeof args.allowShrink === 'boolean' ? { allowShrink: args.allowShrink } : {}),
        ...(typeof args.message === 'string' ? { message: args.message } : {}),
        ...(typeof args.draftId === 'string' ? { draftId: args.draftId } : {}),
      })
    }

    case 'agent_memory_commit': {
      if (args.revision !== null && typeof args.revision !== 'string') {
        throw new MemorySchemaError(
          'INVALID_ARGUMENTS',
          'agent_memory_commit requires revision (string or null).',
        )
      }
      return commitMemoryDraft({
        memoryRoot,
        revision: args.revision,
        ...(typeof args.draftId === 'string' ? { draftId: args.draftId } : {}),
        ...(typeof args.message === 'string' ? { message: args.message } : {}),
        ...(typeof args.allowShrink === 'boolean' ? { allowShrink: args.allowShrink } : {}),
      })
    }

    case 'agent_memory_manage': {
      if (typeof args.action !== 'string') {
        throw new MemorySchemaError('INVALID_ARGUMENTS', 'agent_memory_manage requires action.')
      }
      return manageMemory({
        memoryRoot,
        workspacePath,
        projectSlug,
        action: args.action as ManageAction,
        ...(typeof args.text === 'string' ? { text: args.text } : {}),
        ...(typeof args.path === 'string' ? { path: args.path } : {}),
        ...(typeof args.section === 'string' ? { section: args.section } : {}),
        ...(typeof args.dryRun === 'boolean' ? { dryRun: args.dryRun } : {}),
        ...(typeof args.outputPath === 'string' ? { outputPath: args.outputPath } : {}),
        ...(typeof args.offset === 'number' ? { offset: args.offset } : {}),
        ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
        ...(args.trigger === 'off' || args.trigger === 'step-count'
          ? { trigger: args.trigger as ReflectionTrigger }
          : {}),
        ...(typeof args.stepCountThreshold === 'number'
          ? { stepCountThreshold: args.stepCountThreshold }
          : {}),
        ...(typeof args.model === 'string' ? { model: args.model } : {}),
      })
    }

    case 'agent_memory_reflect': {
      return reflectMemory({
        memoryRoot,
        projectSlug,
        workspacePath,
        ...(typeof args.assignment === 'string' ? { assignment: args.assignment } : {}),
        ...(typeof args.conversationId === 'string' ? { conversationId: args.conversationId } : {}),
        ...(args.mode === 'plan' || args.mode === 'apply' || args.mode === 'mark_reflected'
          ? { mode: args.mode }
          : {}),
        ...(typeof args.model === 'string' ? { model: args.model } : {}),
        ...(typeof args.maxOperations === 'number' ? { maxOperations: args.maxOperations } : {}),
      })
    }

    case 'continuity_recall': {
      if (typeof args.query !== 'string' || !args.query.trim()) {
        throw new MemorySchemaError(
          'INVALID_ARGUMENTS',
          'continuity_recall requires non-empty query.',
        )
      }
      const mode: RecallSearchMode =
        args.mode === 'semantic' || args.mode === 'keyword' || args.mode === 'hybrid'
          ? args.mode
          : 'hybrid'
      const limit =
        typeof args.limit === 'number' && Number.isInteger(args.limit)
          ? Math.min(20, Math.max(1, args.limit))
          : 5
      const excludeConversationIds = Array.isArray(args.excludeConversationIds)
        ? args.excludeConversationIds.filter((id): id is string => typeof id === 'string')
        : undefined
      const envConvId = process.env.ANTIGRAVITY_CONVERSATION_ID || process.env.AGY_CONVERSATION_ID
      const mergedExcludes =
        envConvId && !(excludeConversationIds ?? []).includes(envConvId)
          ? [...(excludeConversationIds ?? []), envConvId]
          : excludeConversationIds

      const hits = await searchRecall(args.query, {
        mode,
        limit,
        excludeConversationIds: mergedExcludes,
      })
      return {
        authority: 'non-binding historical evidence only',
        mode,
        count: hits.length,
        hits: hits.map((hit) => ({
          convId: hit.convId,
          shortId: hit.shortId,
          mtime: hit.mtime.toISOString(),
          score: hit.score,
          bm25Score: hit.bm25Score,
          vectorScore: hit.vectorScore,
          matchedKeywords: hit.matchedKeywords,
          firstPrompt: hit.firstPrompt,
          snippet: hit.snippet,
          stepCount: hit.stepCount,
        })),
      }
    }

    default:
      throw new MemorySchemaError('INVALID_ARGUMENTS', `Unknown tool: ${name}`)
  }
}

function formatToolError(error: unknown): {
  error: true
  code: string
  message: string
  details?: Record<string, unknown>
} {
  if (error instanceof MemoryEngineError) {
    return {
      error: true,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    }
  }
  if (error instanceof MemorySchemaError) {
    return { error: true, code: error.code, message: error.message }
  }
  return {
    error: true,
    code: 'ERROR',
    message: error instanceof Error ? error.message : String(error),
  }
}

export async function handleMcpMessage(
  rawInput: string | JsonRpcRequest,
  context: McpServerContext = {},
): Promise<JsonRpcResponse | null> {
  let parsedInput: unknown = rawInput
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim()
    if (!trimmed) return null
    try {
      parsedInput = JSON.parse(trimmed)
    } catch {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON.' },
      }
    }
  }
  if (!parsedInput || typeof parsedInput !== 'object' || Array.isArray(parsedInput)) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request: expected a JSON-RPC object.' },
    }
  }
  const req = parsedInput as JsonRpcRequest

  const hasId = Object.hasOwn(req, 'id') && req.id !== undefined
  const id = hasId ? (req.id as string | number | null) : null
  const method = req.method

  if (typeof method !== 'string' || !method.trim()) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid Request: missing method.' },
    }
  }

  if (!hasId) {
    // Notification (e.g., notifications/initialized, notifications/cancelled): no reply
    return null
  }

  if (method === 'initialize') {
    const manifest = readPluginManifest()
    const clientVersion =
      typeof req.params?.protocolVersion === 'string' ? req.params.protocolVersion : '2024-11-05'
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(clientVersion)
      ? clientVersion
      : '2024-11-05'
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: {
          name: manifest.name,
          version: manifest.version,
        },
      },
    }
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} }
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: MCP_TOOLS },
    }
  }

  if (method === 'tools/call') {
    const params = req.params ?? {}
    const toolName = typeof params.name === 'string' ? params.name : ''
    try {
      const output = await executeToolCall(toolName, params.arguments, context)
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        },
      }
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(formatToolError(error), null, 2) }],
          isError: true,
        },
      }
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${String(method)}`,
    },
  }
}

async function runStdioServer(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const response = await handleMcpMessage(line)
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`)
      }
    } catch (error) {
      console.error('agy-memory-mcp error:', error instanceof Error ? error.message : String(error))
    }
  }
}

if (isDirectCliInvocation(import.meta.url)) {
  void runStdioServer()
}
