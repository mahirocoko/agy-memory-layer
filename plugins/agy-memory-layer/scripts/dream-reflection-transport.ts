/**
 * Dream v2 reflection transport.
 *
 * Tests inject a fake. The live adapter spawns only evidenced `agy` CLI
 * surfaces and validates the current machine-readable JSON envelope before
 * returning only its structured response to the pure reflector boundary.
 *
 * Plan mode, sandbox mode, and prompt rules do not prove host no-tools
 * enforcement. `hostIsolation` stays `unverified`.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { assertNoDuplicateJsonKeys } from './dream-reflector.ts'

export const PRIMARY_REFLECTION_MODEL = 'claude-opus-4-6-thinking'
export const AGY_REFLECTION_CHILD_ENV = 'AGY_DREAM_REFLECTION_CHILD'
export const REFLECTION_PRINT_TIMEOUT = '120s'
export const REFLECTION_COMMAND_TIMEOUT_MS = 120_000
export const REFLECTION_MAX_STDOUT_BYTES = 1_000_000
export const REFLECTION_MAX_USAGE_TOKENS = 10_000_000
export const REFLECTION_MAX_TURNS = 512
export const REFLECTION_MAX_DURATION_SECONDS = REFLECTION_COMMAND_TIMEOUT_MS / 1000
export const AGY_HOST_ISOLATION_NON_CLAIM =
  'plan mode, sandbox mode, and prompt rules do not prove that the Agy host executed the reflection without tools'

export const AGY_HOST_ISOLATION = 'unverified' as const

export type ReflectionTransportErrorCode =
  | 'RECURSIVE_CHILD'
  | 'MODEL_UNAVAILABLE'
  | 'FALLBACK_REFUSED'
  | 'VERSION_UNAVAILABLE'
  | 'CATALOG_UNAVAILABLE'
  | 'TIMEOUT'
  | 'OUTPUT_OVERFLOW'
  | 'NONZERO_EXIT'
  | 'ENVELOPE_INVALID'
  | 'MODEL_DRIFT'
  | 'HOST_ACTION_DENIED'

export class ReflectionTransportError extends Error {
  readonly code: ReflectionTransportErrorCode

  constructor(code: ReflectionTransportErrorCode, message: string) {
    super(message)
    this.name = 'ReflectionTransportError'
    this.code = code
  }
}

export type ReflectionTransportRequest = {
  prompt: string
  model: string
  jsonSchema: string
  cwd?: string
}

export type ReflectionTransport = {
  reflect: (request: ReflectionTransportRequest) => string
}

export type AgyCommandRequest = {
  args: readonly string[]
  timeoutMs: number
  maxStdoutBytes: number
  env: NodeJS.ProcessEnv
  cwd?: string
}

export type AgyCommandResult = {
  status: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  truncated: boolean
}

export type AgyCommandRunner = (request: AgyCommandRequest) => AgyCommandResult

export type AgyReflectionTransportOptions = {
  run?: AgyCommandRunner
  model?: string
  fallbackModel?: string | null
  maxOperations?: number
}

export type AgyReflectionTransport = ReflectionTransport & {
  readonly hostIsolation: typeof AGY_HOST_ISOLATION
  readonly nonClaim: typeof AGY_HOST_ISOLATION_NON_CLAIM
  readonly observedCliVersion: string | null
}

export const createReflectionRunDirectory = (): { directory: string; remove: () => void } => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-dream-reflection-'))
  fs.chmodSync(directory, 0o700)
  return {
    directory,
    remove: () => {
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}

const reject = (code: ReflectionTransportErrorCode, message: string): never => {
  throw new ReflectionTransportError(code, message)
}

const isExactPrimaryModel = (model: string): boolean => model === PRIMARY_REFLECTION_MODEL

export const reflectionResponseJsonSchema = (maxOperations: number): string =>
  JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'operations'],
    properties: {
      summary: { type: 'string' },
      operations: {
        type: 'array',
        maxItems: maxOperations,
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['op', 'path', 'description', 'body'],
              properties: {
                op: { enum: ['write'] },
                path: { type: 'string' },
                description: { type: 'string' },
                body: { type: 'string' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['op', 'path', 'description'],
              properties: {
                op: { enum: ['delete'] },
                path: { type: 'string' },
                description: { type: 'string' },
              },
            },
          ],
        },
      },
    },
  })

export const buildAgyReflectionPrintArgs = (
  prompt: string,
  model: string,
  jsonSchema: string,
): string[] => [
  '--output-format',
  'json',
  '--json-schema',
  jsonSchema,
  '--model',
  model,
  '--mode',
  'plan',
  '--sandbox',
  '--disable-slash-commands',
  '--print-timeout',
  REFLECTION_PRINT_TIMEOUT,
  '--print',
  prompt,
]

export const buildAgyModelProbeArgs = (model: string): string[] => [
  '--output-format',
  'json',
  '--model',
  model,
  '--mode',
  'plan',
  '--sandbox',
  '--print-timeout',
  REFLECTION_PRINT_TIMEOUT,
  '--print',
  '/model',
]

const CATALOG_STATUS_LINE = 'Fetching available models...'

export const parseAgyModelCatalog = (stdout: string): string[] => {
  const ids: string[] = []
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.trim()) continue
    if (line.trim() === CATALOG_STATUS_LINE) continue
    const tab = line.indexOf('\t')
    if (tab <= 0) {
      reject('CATALOG_UNAVAILABLE', 'Agy model catalog row is not an id and label.')
    }
    const id = line.slice(0, tab).trim()
    const label = line.slice(tab + 1)
    if (!id || !label.trim() || /\s/.test(id)) {
      reject('CATALOG_UNAVAILABLE', 'Agy model catalog id is not a single token.')
    }
    ids.push(id)
  }
  if (ids.length === 0) {
    reject('CATALOG_UNAVAILABLE', 'Agy model catalog did not list any models.')
  }
  return ids
}

const parseAgyVersion = (stdout: string): string => {
  const version = stdout.trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    reject('VERSION_UNAVAILABLE', 'Agy version output is not an exact major.minor.patch line.')
  }
  return version
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const keySet = new Set(allowed)
  return Object.keys(value).every((key) => keySet.has(key))
}

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const isBoundedCounter = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max

const hasWhitespaceOrControl = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return /\s/u.test(character) || codePoint <= 31 || codePoint === 127
  })

const parseJsonObject = (stdout: string, owner: string): Record<string, unknown> => {
  try {
    assertNoDuplicateJsonKeys(stdout)
  } catch {
    return reject('ENVELOPE_INVALID', `${owner} is not strict unambiguous JSON.`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return reject('ENVELOPE_INVALID', `${owner} is not one complete JSON object.`)
  }
  if (!isRecord(parsed)) {
    return reject('ENVELOPE_INVALID', `${owner} must be a JSON object.`)
  }
  return parsed
}

const canonicalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((entry) => canonicalizeJson(entry))
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeJson(value[key])]),
  )
}

const hasEquivalentJsonValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonicalizeJson(left)) === JSON.stringify(canonicalizeJson(right))

const validateUsage = (value: unknown, owner: string): void => {
  const usage = isRecord(value)
    ? value
    : reject('ENVELOPE_INVALID', `${owner} usage must be an object.`)
  const keys = [
    'input_tokens',
    'output_tokens',
    'thinking_tokens',
    'cache_read_tokens',
    'total_tokens',
  ] as const
  if (
    !hasOnlyKeys(usage, keys) ||
    keys.some((key) => !isBoundedCounter(usage[key], REFLECTION_MAX_USAGE_TOKENS))
  ) {
    reject('ENVELOPE_INVALID', `${owner} usage does not match the current Agy contract.`)
  }
}

export const parseAgyModelProbeEnvelope = (stdout: string): string => {
  const envelope = parseJsonObject(stdout, 'Agy model probe envelope')
  const keys = [
    'conversation_id',
    'status',
    'response',
    'duration_seconds',
    'num_turns',
    'usage',
    'command',
  ] as const
  if (!hasOnlyKeys(envelope, keys) || Object.keys(envelope).length !== keys.length) {
    return reject('ENVELOPE_INVALID', 'Agy model probe envelope keys drifted.')
  }
  if (
    envelope.conversation_id !== '' ||
    envelope.status !== 'SUCCESS' ||
    typeof envelope.response !== 'string' ||
    !isNonNegativeNumber(envelope.duration_seconds) ||
    envelope.duration_seconds > REFLECTION_MAX_DURATION_SECONDS ||
    envelope.num_turns !== 0
  ) {
    return reject('ENVELOPE_INVALID', 'Agy model probe envelope values are invalid.')
  }
  validateUsage(envelope.usage, 'Agy model probe envelope')
  const command = envelope.command
  if (
    !isRecord(command) ||
    !hasOnlyKeys(command, ['name', 'data']) ||
    Object.keys(command).length !== 2 ||
    command.name !== 'model' ||
    !isRecord(command.data) ||
    !hasOnlyKeys(command.data, ['id', 'label', 'is_default']) ||
    Object.keys(command.data).length !== 3 ||
    typeof command.data.id !== 'string' ||
    typeof command.data.label !== 'string' ||
    typeof command.data.is_default !== 'boolean'
  ) {
    return reject('ENVELOPE_INVALID', 'Agy model probe command payload is invalid.')
  }
  const expectedResponse = `${command.data.id}\t${command.data.label}\n`
  if (envelope.response !== expectedResponse) {
    return reject(
      'MODEL_DRIFT',
      'Agy model probe response does not match its structured model command payload.',
    )
  }
  return command.data.id
}

export const parseAgyReflectionEnvelope = (stdout: string, expectedJsonSchema: string): string => {
  const envelope = parseJsonObject(stdout, 'Agy reflection envelope')
  const requiredKeys = [
    'conversation_id',
    'status',
    'response',
    'duration_seconds',
    'num_turns',
    'structured_output',
    'json_schema',
    'usage',
  ] as const
  if (
    !requiredKeys.every((key) => key in envelope) ||
    !hasOnlyKeys(envelope, [...requiredKeys, 'denied_actions'])
  ) {
    return reject('ENVELOPE_INVALID', 'Agy reflection envelope keys drifted.')
  }
  if (
    typeof envelope.conversation_id !== 'string' ||
    envelope.conversation_id.length < 1 ||
    envelope.conversation_id.length > 128 ||
    hasWhitespaceOrControl(envelope.conversation_id) ||
    envelope.status !== 'SUCCESS' ||
    !isNonNegativeNumber(envelope.duration_seconds) ||
    envelope.duration_seconds > REFLECTION_MAX_DURATION_SECONDS ||
    !isBoundedCounter(envelope.num_turns, REFLECTION_MAX_TURNS) ||
    envelope.num_turns < 1
  ) {
    return reject('ENVELOPE_INVALID', 'Agy reflection envelope values are invalid.')
  }
  validateUsage(envelope.usage, 'Agy reflection envelope')
  const expectedSchema = parseJsonObject(expectedJsonSchema, 'Requested Agy JSON schema')
  if (!isRecord(envelope.json_schema)) {
    return reject('ENVELOPE_INVALID', 'Agy reflection json_schema must be an object.')
  }
  if (!hasEquivalentJsonValue(envelope.json_schema, expectedSchema)) {
    return reject(
      'ENVELOPE_INVALID',
      'Agy reflection json_schema does not match the requested schema.',
    )
  }
  if (!isRecord(envelope.structured_output)) {
    return reject('ENVELOPE_INVALID', 'Agy reflection structured_output must be an object.')
  }
  if ('denied_actions' in envelope) {
    if (!Array.isArray(envelope.denied_actions)) {
      return reject('ENVELOPE_INVALID', 'Agy denied_actions must be an array.')
    }
    if (envelope.denied_actions.length > 0) {
      return reject('HOST_ACTION_DENIED', 'Agy reported denied host actions during reflection.')
    }
  }
  if (typeof envelope.response !== 'string' || !envelope.response.trim()) {
    return reject('ENVELOPE_INVALID', 'Agy reflection response must be a nonempty string.')
  }
  return JSON.stringify(envelope.structured_output)
}

export const runBoundedAgyCommand = (request: AgyCommandRequest): AgyCommandResult => {
  const result = spawnSync('agy', [...request.args], {
    encoding: 'utf8',
    timeout: request.timeoutMs,
    maxBuffer: request.maxStdoutBytes,
    env: request.env,
    cwd: request.cwd,
    windowsHide: true,
  })
  const errorCode = result.error && 'code' in result.error ? String(result.error.code) : undefined
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: errorCode === 'ETIMEDOUT',
    truncated: errorCode === 'ENOBUFS',
  }
}

const runChecked = (
  run: AgyCommandRunner,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
): AgyCommandResult => {
  const result = run({
    args,
    timeoutMs: REFLECTION_COMMAND_TIMEOUT_MS,
    maxStdoutBytes: REFLECTION_MAX_STDOUT_BYTES,
    env,
    cwd,
  })
  if (result.timedOut) reject('TIMEOUT', 'Agy command timed out before a reflection result.')
  if (result.truncated) reject('OUTPUT_OVERFLOW', 'Agy command exceeded the stdout byte bound.')
  if (result.status !== 0) {
    reject('NONZERO_EXIT', `Agy command exited ${result.status ?? 'without a status'}.`)
  }
  return result
}

export const createAgyReflectionTransport = (
  options: AgyReflectionTransportOptions = {},
): AgyReflectionTransport => {
  const run = options.run ?? runBoundedAgyCommand
  const model = options.model ?? PRIMARY_REFLECTION_MODEL
  const fallbackModel = options.fallbackModel === undefined ? null : options.fallbackModel
  const maxOperations = options.maxOperations ?? 8
  let observedCliVersion: string | null = null

  return {
    hostIsolation: AGY_HOST_ISOLATION,
    nonClaim: AGY_HOST_ISOLATION_NON_CLAIM,
    get observedCliVersion(): string | null {
      return observedCliVersion
    },
    reflect(request: ReflectionTransportRequest): string {
      if (process.env[AGY_REFLECTION_CHILD_ENV] === '1') {
        return reject('RECURSIVE_CHILD', 'Refusing a nested Dream v2 reflection child.')
      }
      if (!isExactPrimaryModel(model) || !isExactPrimaryModel(request.model)) {
        return reject(
          'MODEL_UNAVAILABLE',
          `Dream v2 requires exact model ${PRIMARY_REFLECTION_MODEL} and does not substitute another catalog entry.`,
        )
      }
      if (fallbackModel !== null) {
        return reject(
          'FALLBACK_REFUSED',
          'Dream v2 has no earned fallback model and will not substitute a catalog entry.',
        )
      }

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        [AGY_REFLECTION_CHILD_ENV]: '1',
      }
      const version = runChecked(run, ['--version'], env, request.cwd)
      observedCliVersion = parseAgyVersion(version.stdout)
      const catalog = runChecked(run, ['models'], env, request.cwd)
      const ids = parseAgyModelCatalog(catalog.stdout)
      if (!ids.includes(PRIMARY_REFLECTION_MODEL)) {
        return reject(
          'MODEL_UNAVAILABLE',
          `${PRIMARY_REFLECTION_MODEL} is absent from the fresh Agy catalog. Gemini models are not a substitute.`,
        )
      }

      const modelProbe = runChecked(
        run,
        buildAgyModelProbeArgs(PRIMARY_REFLECTION_MODEL),
        env,
        request.cwd,
      )
      const resolvedModel = parseAgyModelProbeEnvelope(modelProbe.stdout)
      if (resolvedModel !== PRIMARY_REFLECTION_MODEL) {
        return reject(
          'MODEL_DRIFT',
          `Agy resolved ${PRIMARY_REFLECTION_MODEL} to ${resolvedModel}; reflection was not started.`,
        )
      }

      const schema = request.jsonSchema || reflectionResponseJsonSchema(maxOperations)
      const result = runChecked(
        run,
        buildAgyReflectionPrintArgs(request.prompt, PRIMARY_REFLECTION_MODEL, schema),
        env,
        request.cwd,
      )
      return parseAgyReflectionEnvelope(result.stdout, schema)
    },
  }
}

export const createFakeReflectionTransport = (
  respond: (request: ReflectionTransportRequest) => string,
): ReflectionTransport & { readonly calls: ReflectionTransportRequest[] } => {
  const calls: ReflectionTransportRequest[] = []
  return {
    calls,
    reflect(request: ReflectionTransportRequest): string {
      calls.push(request)
      return respond(request)
    },
  }
}
