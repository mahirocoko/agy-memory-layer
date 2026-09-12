import { createHash } from 'node:crypto'
import {
  computeManifestHash,
  deriveRetrievalAccounting,
  type FrozenContractBindings,
  type HostEvidence,
  type HostEvidenceManifest,
  parseFrozenContractBindings,
  parseHostEvidence,
  parseHostEvidenceManifest,
  type StrictFinalResponse,
  stableJson,
} from './host-evidence-contract.ts'

export type EffectOperation =
  | 'conversation-create'
  | 'user-input'
  | 'planner-continuation'
  | 'tool'
  | 'retrieval'

export type ReceiptPayload =
  | {
      event: 'authorized'
      descriptorHash: string
      manifestHash: string
      bindingsHash: string
      scope: 'offline-only'
    }
  | { event: 'attempt.reserved'; attemptId: string; nonce: string; processId: string }
  | {
      event: 'shell.ready'
      attemptId: string
      nonce: string
      stdout: string
      shellProcessId: string
      foregroundProcessId: string
    }
  | {
      event: 'trust.accepted'
      attemptId: string
      workspacePath: string
      workspaceDev: number
      workspaceIno: number
    }
  | {
      event: 'host.observed'
      attemptId: string
      agyVersion: string
      model: string
      effort: string
    }
  | { event: 'effect.reserved'; attemptId: string; effectId: string; operation: EffectOperation }
  | { event: 'effect.submitted'; attemptId: string; effectId: string }
  | {
      event: 'conversation.created'
      attemptId: string
      effectId: string
      conversationId: string
    }
  | {
      event: 'user-input.observed'
      attemptId: string
      effectId: string
      conversationId: string
      structured: boolean
      taskId: string
      promptHash: string
    }
  | {
      event: 'planner.response'
      attemptId: string
      effectId: string
      conversationId: string
      kind: 'ordinary' | 'intermediate' | 'final'
      response: StrictFinalResponse | null
    }
  | {
      event: 'tool.result'
      attemptId: string
      effectId: string
      conversationId: string
      tool: string
      success: boolean
      content: string
    }
  | {
      event: 'retrieval.result'
      attemptId: string
      effectId: string
      conversationId: string
      query: string
      owner: string
      source: string
      success: boolean
      content: string
    }
  | {
      event: 'provider.action'
      attemptId: string
      effectId: string
      conversationId: string
      action: string
    }
  | {
      event: 'provider.request'
      attemptId: string
      effectId: string
      conversationId: string
      requestId: string
    }
  | {
      event: 'memory.mutation'
      attemptId: string
      effectId: string
      conversationId: string
      path: string
    }
  | {
      event: 'transport.failed'
      attemptId: string
      effectId: string | null
      uncertainty: 'before-submission' | 'after-submission'
      label: string
    }
  | {
      event: 'effect.reconciled'
      reservationKind: 'attempt' | 'effect'
      reservationId: string
      resolution: 'not-submitted' | 'completed' | 'unknown'
      observationSequences: number[]
    }
  | {
      event: 'observations.closed'
      captureTruncated: boolean
      truncatedFields: string[]
      providerRequestVisibility: 'complete' | 'incomplete'
    }

export type Receipt = {
  schemaVersion: 1
  runId: string
  sequence: number
  attemptId: string | null
  conversationId: string | null
  manifestHash: string
  previousHash: string
  payload: ReceiptPayload
  receiptHash: string
}

export type RunDescriptor = {
  schemaVersion: 1
  runId: string
  rootDev: number
  rootIno: number
  workspacePath: string
  workspaceDev: number
  workspaceIno: number
  uid: number
  gid: number
  trustRequired: boolean
  scope: 'offline-only'
  limits: {
    maxFileBytes: number
    maxTotalBytes: number
    maxReceipts: number
    maxJsonDepth: number
  }
}

export type ReplayContext = {
  descriptor: RunDescriptor
  manifest: HostEvidenceManifest
  bindings: FrozenContractBindings
  descriptorHash: string
  manifestHash: string
  bindingsHash: string
  lockHash: string
}

export type ReplayResult = {
  readonly valid: true
  readonly context: ReplayContext
  readonly receipts: readonly Receipt[]
  readonly phase: 'PREPARED' | 'AUTHORIZED' | 'ACTIVE' | 'OBSERVATIONS_CLOSED'
  readonly unresolvedReservations: readonly string[]
  readonly firstFinalSequence: number | null
}

export type DerivedHostEvidence =
  | { status: 'ready'; evidence: HostEvidence }
  | { status: 'incomplete'; reasons: string[] }
  | { status: 'invalid'; failures: string[] }

type ObjectRecord = Record<string, unknown>
type AttemptState = {
  state: 'RESERVED' | 'READY' | 'RUNNING' | 'BLOCKED_ON_RECONCILIATION'
  nonce: string
  processId: string
  shellReady: boolean
  trustAccepted: boolean
  hostObserved: boolean
  conversationId: string | null
  inputObserved: boolean
  failureRecorded: boolean
  failureUncertainty: 'before-submission' | 'after-submission' | null
  reconciliation: 'unknown' | 'not-submitted' | 'completed' | null
}
type EffectState = {
  attemptId: string
  operation: EffectOperation
  state: 'RESERVED' | 'SUBMITTED' | 'COMPLETED' | 'UNRESOLVED' | 'NOT_SUBMITTED' | 'CONTRADICTED'
  observationSequences: number[]
  submitted: boolean
  failureUncertainty: 'before-submission' | 'after-submission' | null
  terminalResultSequence: number | null
  reconciliation: 'unknown' | 'not-submitted' | 'completed' | null
}

const SHA256 = /^[a-f0-9]{64}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const validatedReplays = new WeakSet<object>()

function fail(path: string, message: string): never {
  throw new TypeError(`${path}: ${message}`)
}

function record(value: unknown, path: string): ObjectRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(path, 'expected object')
  return value as ObjectRecord
}

function keys(input: ObjectRecord, expected: readonly string[], path: string): void {
  const actual = Object.keys(input).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(path, `expected exact keys ${wanted.join(', ')}`)
  }
}

function text(value: unknown, path: string, allowEmpty = false, maximum = 8192): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximum ||
    value.includes('\0')
  ) {
    fail(path, `expected ${allowEmpty ? '' : 'non-empty '}bounded string`)
  }
  return value
}

function id(value: unknown, path: string): string {
  const parsed = text(value, path, false, 128)
  if (!ID.test(parsed)) fail(path, 'expected safe identifier')
  return parsed
}

function hash(value: unknown, path: string): string {
  const parsed = text(value, path, false, 64)
  if (!SHA256.test(parsed)) fail(path, 'expected lowercase SHA-256 hex')
  return parsed
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected boolean')
  return value
}

function integer(value: unknown, path: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    fail(path, `expected ${positive ? 'positive' : 'nonnegative'} safe integer`)
  }
  return value
}

function literal<T extends string | number>(value: unknown, expected: T, path: string): T {
  if (value !== expected) fail(path, `expected literal ${String(expected)}`)
  return expected
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(path, `expected one of ${allowed.join(', ')}`)
  }
  return value as T
}

function nullableId(value: unknown, path: string): string | null {
  return value === null ? null : id(value, path)
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 128) fail(path, 'expected bounded array')
  const parsed = value.map((entry, index) => text(entry, `${path}[${index}]`))
  if (new Set(parsed).size !== parsed.length) fail(path, 'expected unique strings')
  return parsed
}

function integerList(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || value.length > 256) fail(path, 'expected bounded array')
  const parsed = value.map((entry, index) => integer(entry, `${path}[${index}]`, true))
  if (new Set(parsed).size !== parsed.length) fail(path, 'expected unique integers')
  return parsed
}

function parseFinal(value: unknown, path: string): StrictFinalResponse {
  const input = record(value, path)
  keys(input, ['answer', 'sources', 'status', 'taskId'], path)
  const answer = record(input.answer, `${path}.answer`)
  if (Object.keys(answer).length > 64) fail(`${path}.answer`, 'too many fields')
  return {
    taskId: id(input.taskId, `${path}.taskId`),
    status: oneOf(input.status, ['ANSWERED', 'UNKNOWN'] as const, `${path}.status`),
    answer: Object.fromEntries(
      Object.entries(answer).map(([name, entry]) => [
        id(name, `${path}.answer key`),
        text(entry, `${path}.answer.${name}`, true),
      ]),
    ),
    sources: stringList(input.sources, `${path}.sources`),
  }
}

function commonCorrelation(
  input: ObjectRecord,
  path: string,
): {
  attemptId: string
  effectId: string
  conversationId: string
} {
  return {
    attemptId: id(input.attemptId, `${path}.attemptId`),
    effectId: id(input.effectId, `${path}.effectId`),
    conversationId: id(input.conversationId, `${path}.conversationId`),
  }
}

export function parseReceiptPayload(value: unknown, path = 'receipt.payload'): ReceiptPayload {
  const input = record(value, path)
  const event = text(input.event, `${path}.event`)
  switch (event) {
    case 'authorized':
      keys(input, ['bindingsHash', 'descriptorHash', 'event', 'manifestHash', 'scope'], path)
      return {
        event,
        descriptorHash: hash(input.descriptorHash, `${path}.descriptorHash`),
        manifestHash: hash(input.manifestHash, `${path}.manifestHash`),
        bindingsHash: hash(input.bindingsHash, `${path}.bindingsHash`),
        scope: literal(input.scope, 'offline-only', `${path}.scope`),
      }
    case 'attempt.reserved':
      keys(input, ['attemptId', 'event', 'nonce', 'processId'], path)
      return {
        event,
        attemptId: id(input.attemptId, `${path}.attemptId`),
        nonce: id(input.nonce, `${path}.nonce`),
        processId: id(input.processId, `${path}.processId`),
      }
    case 'shell.ready':
      keys(
        input,
        ['attemptId', 'event', 'foregroundProcessId', 'nonce', 'shellProcessId', 'stdout'],
        path,
      )
      return {
        event,
        attemptId: id(input.attemptId, `${path}.attemptId`),
        nonce: id(input.nonce, `${path}.nonce`),
        stdout: text(input.stdout, `${path}.stdout`, true),
        shellProcessId: id(input.shellProcessId, `${path}.shellProcessId`),
        foregroundProcessId: id(input.foregroundProcessId, `${path}.foregroundProcessId`),
      }
    case 'trust.accepted':
      keys(input, ['attemptId', 'event', 'workspaceDev', 'workspaceIno', 'workspacePath'], path)
      return {
        event,
        attemptId: id(input.attemptId, `${path}.attemptId`),
        workspacePath: text(input.workspacePath, `${path}.workspacePath`),
        workspaceDev: integer(input.workspaceDev, `${path}.workspaceDev`),
        workspaceIno: integer(input.workspaceIno, `${path}.workspaceIno`),
      }
    case 'host.observed':
      keys(input, ['agyVersion', 'attemptId', 'effort', 'event', 'model'], path)
      return {
        event,
        attemptId: id(input.attemptId, `${path}.attemptId`),
        agyVersion: text(input.agyVersion, `${path}.agyVersion`),
        model: text(input.model, `${path}.model`),
        effort: text(input.effort, `${path}.effort`),
      }
    case 'effect.reserved':
      keys(input, ['attemptId', 'effectId', 'event', 'operation'], path)
      return {
        event,
        attemptId: id(input.attemptId, `${path}.attemptId`),
        effectId: id(input.effectId, `${path}.effectId`),
        operation: oneOf(
          input.operation,
          [
            'conversation-create',
            'user-input',
            'planner-continuation',
            'tool',
            'retrieval',
          ] as const,
          `${path}.operation`,
        ),
      }
    case 'effect.submitted':
      keys(input, ['attemptId', 'effectId', 'event'], path)
      return {
        event,
        attemptId: id(input.attemptId, `${path}.attemptId`),
        effectId: id(input.effectId, `${path}.effectId`),
      }
    case 'conversation.created': {
      keys(input, ['attemptId', 'conversationId', 'effectId', 'event'], path)
      return { event, ...commonCorrelation(input, path) }
    }
    case 'user-input.observed': {
      keys(
        input,
        ['attemptId', 'conversationId', 'effectId', 'event', 'promptHash', 'structured', 'taskId'],
        path,
      )
      return {
        event,
        ...commonCorrelation(input, path),
        structured: bool(input.structured, `${path}.structured`),
        taskId: id(input.taskId, `${path}.taskId`),
        promptHash: hash(input.promptHash, `${path}.promptHash`),
      }
    }
    case 'planner.response': {
      keys(input, ['attemptId', 'conversationId', 'effectId', 'event', 'kind', 'response'], path)
      const kind = oneOf(input.kind, ['ordinary', 'intermediate', 'final'] as const, `${path}.kind`)
      if (kind === 'final' && input.response === null)
        fail(`${path}.response`, 'final requires response')
      if (kind !== 'final' && input.response !== null)
        fail(`${path}.response`, 'non-final requires null')
      return {
        event,
        ...commonCorrelation(input, path),
        kind,
        response: input.response === null ? null : parseFinal(input.response, `${path}.response`),
      }
    }
    case 'tool.result':
      keys(
        input,
        ['attemptId', 'content', 'conversationId', 'effectId', 'event', 'success', 'tool'],
        path,
      )
      return {
        event,
        ...commonCorrelation(input, path),
        tool: text(input.tool, `${path}.tool`),
        success: bool(input.success, `${path}.success`),
        content: text(input.content, `${path}.content`, true, 131072),
      }
    case 'retrieval.result':
      keys(
        input,
        [
          'attemptId',
          'content',
          'conversationId',
          'effectId',
          'event',
          'owner',
          'query',
          'source',
          'success',
        ],
        path,
      )
      return {
        event,
        ...commonCorrelation(input, path),
        query: text(input.query, `${path}.query`),
        owner: text(input.owner, `${path}.owner`),
        source: text(input.source, `${path}.source`),
        success: bool(input.success, `${path}.success`),
        content: text(input.content, `${path}.content`, true, 131072),
      }
    case 'provider.action':
      keys(input, ['action', 'attemptId', 'conversationId', 'effectId', 'event'], path)
      return {
        event,
        ...commonCorrelation(input, path),
        action: text(input.action, `${path}.action`),
      }
    case 'provider.request':
      keys(input, ['attemptId', 'conversationId', 'effectId', 'event', 'requestId'], path)
      return {
        event,
        ...commonCorrelation(input, path),
        requestId: id(input.requestId, `${path}.requestId`),
      }
    case 'memory.mutation':
      keys(input, ['attemptId', 'conversationId', 'effectId', 'event', 'path'], path)
      return { event, ...commonCorrelation(input, path), path: text(input.path, `${path}.path`) }
    case 'transport.failed':
      keys(input, ['attemptId', 'effectId', 'event', 'label', 'uncertainty'], path)
      return {
        event,
        attemptId: id(input.attemptId, `${path}.attemptId`),
        effectId: nullableId(input.effectId, `${path}.effectId`),
        uncertainty: oneOf(
          input.uncertainty,
          ['before-submission', 'after-submission'] as const,
          `${path}.uncertainty`,
        ),
        label: text(input.label, `${path}.label`),
      }
    case 'effect.reconciled':
      keys(
        input,
        ['event', 'observationSequences', 'reservationId', 'reservationKind', 'resolution'],
        path,
      )
      return {
        event,
        reservationKind: oneOf(
          input.reservationKind,
          ['attempt', 'effect'] as const,
          `${path}.reservationKind`,
        ),
        reservationId: id(input.reservationId, `${path}.reservationId`),
        resolution: oneOf(
          input.resolution,
          ['not-submitted', 'completed', 'unknown'] as const,
          `${path}.resolution`,
        ),
        observationSequences: integerList(
          input.observationSequences,
          `${path}.observationSequences`,
        ),
      }
    case 'observations.closed':
      keys(
        input,
        ['captureTruncated', 'event', 'providerRequestVisibility', 'truncatedFields'],
        path,
      )
      return {
        event,
        captureTruncated: bool(input.captureTruncated, `${path}.captureTruncated`),
        truncatedFields: stringList(input.truncatedFields, `${path}.truncatedFields`),
        providerRequestVisibility: oneOf(
          input.providerRequestVisibility,
          ['complete', 'incomplete'] as const,
          `${path}.providerRequestVisibility`,
        ),
      }
    default:
      fail(`${path}.event`, 'unknown event')
  }
}

export function parseReceipt(value: unknown): Receipt {
  const input = record(value, 'receipt')
  keys(
    input,
    [
      'attemptId',
      'conversationId',
      'manifestHash',
      'payload',
      'previousHash',
      'receiptHash',
      'runId',
      'schemaVersion',
      'sequence',
    ],
    'receipt',
  )
  return {
    schemaVersion: literal(input.schemaVersion, 1, 'receipt.schemaVersion'),
    runId: id(input.runId, 'receipt.runId'),
    sequence: integer(input.sequence, 'receipt.sequence', true),
    attemptId: nullableId(input.attemptId, 'receipt.attemptId'),
    conversationId: nullableId(input.conversationId, 'receipt.conversationId'),
    manifestHash: hash(input.manifestHash, 'receipt.manifestHash'),
    previousHash: hash(input.previousHash, 'receipt.previousHash'),
    payload: parseReceiptPayload(input.payload),
    receiptHash: hash(input.receiptHash, 'receipt.receiptHash'),
  }
}

export function parseRunDescriptor(value: unknown): RunDescriptor {
  const input = record(value, 'descriptor')
  keys(
    input,
    [
      'gid',
      'limits',
      'rootDev',
      'rootIno',
      'runId',
      'schemaVersion',
      'scope',
      'trustRequired',
      'uid',
      'workspaceDev',
      'workspaceIno',
      'workspacePath',
    ],
    'descriptor',
  )
  const limits = record(input.limits, 'descriptor.limits')
  keys(
    limits,
    ['maxFileBytes', 'maxJsonDepth', 'maxReceipts', 'maxTotalBytes'],
    'descriptor.limits',
  )
  return {
    schemaVersion: literal(input.schemaVersion, 1, 'descriptor.schemaVersion'),
    runId: id(input.runId, 'descriptor.runId'),
    rootDev: integer(input.rootDev, 'descriptor.rootDev'),
    rootIno: integer(input.rootIno, 'descriptor.rootIno'),
    workspacePath: text(input.workspacePath, 'descriptor.workspacePath'),
    workspaceDev: integer(input.workspaceDev, 'descriptor.workspaceDev'),
    workspaceIno: integer(input.workspaceIno, 'descriptor.workspaceIno'),
    uid: integer(input.uid, 'descriptor.uid'),
    gid: integer(input.gid, 'descriptor.gid'),
    trustRequired: bool(input.trustRequired, 'descriptor.trustRequired'),
    scope: literal(input.scope, 'offline-only', 'descriptor.scope'),
    limits: {
      maxFileBytes: integer(limits.maxFileBytes, 'descriptor.limits.maxFileBytes', true),
      maxTotalBytes: integer(limits.maxTotalBytes, 'descriptor.limits.maxTotalBytes', true),
      maxReceipts: integer(limits.maxReceipts, 'descriptor.limits.maxReceipts', true),
      maxJsonDepth: integer(limits.maxJsonDepth, 'descriptor.limits.maxJsonDepth', true),
    },
  }
}

function digest(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(`${domain}\0${stableJson(value)}`, 'utf8')
    .digest('hex')
}

export function hashCanonical(domain: string, value: unknown): string {
  return digest(domain, value)
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry)
    Object.freeze(value)
  }
  return value
}

export function validatePhase2Manifest(value: unknown): HostEvidenceManifest {
  const manifest = parseHostEvidenceManifest(value)
  id(manifest.cellId, 'manifest.cellId')
  id(manifest.taskId, 'manifest.taskId')
  text(manifest.plannedHost.agyVersion, 'manifest.plannedHost.agyVersion')
  text(manifest.plannedHost.model, 'manifest.plannedHost.model')
  text(manifest.plannedHost.effort, 'manifest.plannedHost.effort')
  text(manifest.expectedResponse.canonicalSource, 'manifest.expectedResponse.canonicalSource')
  text(manifest.retrieval.canonicalOwner, 'manifest.retrieval.canonicalOwner')
  if (manifest.expectedResponse.fields.length > 64)
    fail('manifest.expectedResponse.fields', 'too many fields for Phase 2')
  for (const [index, field] of manifest.expectedResponse.fields.entries()) {
    id(field.name, `manifest.expectedResponse.fields[${index}].name`)
    text(field.value, `manifest.expectedResponse.fields[${index}].value`, true)
  }
  if (manifest.retrieval.requiredFactMarkers.length > 128)
    fail('manifest.retrieval.requiredFactMarkers', 'too many markers for Phase 2')
  for (const [index, marker] of manifest.retrieval.requiredFactMarkers.entries()) {
    text(marker, `manifest.retrieval.requiredFactMarkers[${index}]`)
  }
  return manifest
}

export function normalizeReplayContext(value: ReplayContext): ReplayContext {
  const input = record(value, 'context')
  keys(
    input,
    [
      'bindings',
      'bindingsHash',
      'descriptor',
      'descriptorHash',
      'lockHash',
      'manifest',
      'manifestHash',
    ],
    'context',
  )
  const descriptor = parseRunDescriptor(structuredClone(input.descriptor))
  const manifest = validatePhase2Manifest(structuredClone(input.manifest))
  const bindings = parseFrozenContractBindings(structuredClone(input.bindings))
  const descriptorHash = hash(input.descriptorHash, 'context.descriptorHash')
  const manifestHash = hash(input.manifestHash, 'context.manifestHash')
  const bindingsHash = hash(input.bindingsHash, 'context.bindingsHash')
  const lockHash = hash(input.lockHash, 'context.lockHash')
  if (descriptorHash !== hashCanonical('host-evidence-descriptor-v1', descriptor))
    fail('context.descriptorHash', 'descriptor mismatch')
  if (manifestHash !== computeManifestHash(manifest))
    fail('context.manifestHash', 'manifest mismatch')
  if (
    bindings.manifestHash !== manifestHash ||
    bindings.promptHash !== manifest.promptHash ||
    bindings.answerKeyHash !== manifest.answerKeyHash ||
    bindings.scorerHash !== manifest.scorerHash
  )
    fail('context.bindings', 'frozen bindings mismatch')
  if (bindingsHash !== hashCanonical('host-evidence-bindings-v1', bindings))
    fail('context.bindingsHash', 'bindings mismatch')
  return deepFreeze({
    descriptor,
    manifest,
    bindings,
    descriptorHash,
    manifestHash,
    bindingsHash,
    lockHash,
  })
}

export function computeGenesisHash(context: ReplayContext): string {
  return digest('host-evidence-genesis-v1', {
    bindingsHash: context.bindingsHash,
    descriptorHash: context.descriptorHash,
    lockHash: context.lockHash,
    manifestHash: context.manifestHash,
  })
}

export function computeReceiptHash(receipt: Omit<Receipt, 'receiptHash'>): string {
  return digest('host-evidence-receipt-v1', receipt)
}

export function createReceipt(
  context: ReplayContext,
  previous: Receipt | null,
  payloadInput: unknown,
): Receipt {
  const payload = parseReceiptPayload(payloadInput)
  const attemptId = 'attemptId' in payload ? payload.attemptId : null
  const conversationId = 'conversationId' in payload ? payload.conversationId : null
  const unsigned: Omit<Receipt, 'receiptHash'> = {
    schemaVersion: 1,
    runId: context.descriptor.runId,
    sequence: (previous?.sequence ?? 0) + 1,
    attemptId,
    conversationId,
    manifestHash: context.manifestHash,
    previousHash: previous?.receiptHash ?? computeGenesisHash(context),
    payload,
  }
  return { ...unsigned, receiptHash: computeReceiptHash(unsigned) }
}

function requireAttempt(attempts: Map<string, AttemptState>, attemptId: string): AttemptState {
  const attempt = attempts.get(attemptId)
  if (!attempt) throw new Error(`lifecycle: unknown attempt ${attemptId}`)
  return attempt
}

function requireEffect(
  effects: Map<string, EffectState>,
  effectId: string,
  attemptId: string,
): EffectState {
  const effect = effects.get(effectId)
  if (!effect) throw new Error(`lifecycle: unknown effect ${effectId}`)
  if (effect.attemptId !== attemptId) throw new Error('lifecycle: cross-attempt effect correlation')
  return effect
}

function verifyCorrelation(receipt: Receipt): void {
  const payloadAttempt = 'attemptId' in receipt.payload ? receipt.payload.attemptId : null
  const payloadConversation =
    'conversationId' in receipt.payload ? receipt.payload.conversationId : null
  if (receipt.attemptId !== payloadAttempt || receipt.conversationId !== payloadConversation) {
    throw new Error('integrity: envelope correlation mismatch')
  }
}

type ReconciliationPayload = Extract<ReceiptPayload, { event: 'effect.reconciled' }>

function terminalOperation(event: ReceiptPayload['event']): EffectOperation | 'planner' | null {
  if (event === 'conversation.created') return 'conversation-create'
  if (event === 'user-input.observed') return 'user-input'
  if (event === 'planner.response') return 'planner'
  if (event === 'tool.result') return 'tool'
  if (event === 'retrieval.result') return 'retrieval'
  return null
}

function validateEffectReconciliation(
  receipts: readonly Receipt[],
  currentSequence: number,
  payload: ReconciliationPayload,
  effect: EffectState,
): void {
  if (new Set(payload.observationSequences).size !== payload.observationSequences.length)
    throw new Error('integrity: duplicate reconciliation observation')
  if (payload.resolution === 'unknown') {
    if (payload.observationSequences.length !== 0)
      throw new Error('completion: unknown reconciliation cannot cite observations')
    return
  }
  if (payload.resolution === 'not-submitted') {
    if (
      effect.submitted ||
      effect.observationSequences.length !== 0 ||
      effect.terminalResultSequence !== null
    ) {
      throw new Error('lifecycle: submitted or observed effect cannot reconcile not-submitted')
    }
    if (payload.observationSequences.length !== 0)
      throw new Error('completion: not-submitted reconciliation cannot cite observations')
    return
  }
  if (!effect.submitted)
    throw new Error('lifecycle: completed reconciliation requires exact effect submission')
  if (payload.observationSequences.length === 0)
    throw new Error('completion: completed reconciliation needs observations')
  for (const sequence of payload.observationSequences) {
    if (sequence >= currentSequence)
      throw new Error('integrity: reconciliation cites self or future')
    const observation = receipts[sequence - 1]
    const operation = observation ? terminalOperation(observation.payload.event) : null
    if (
      !observation ||
      !effect.observationSequences.includes(sequence) ||
      operation === null ||
      !('effectId' in observation.payload) ||
      observation.payload.effectId !== payload.reservationId ||
      !('attemptId' in observation.payload) ||
      observation.payload.attemptId !== effect.attemptId ||
      (operation !== effect.operation &&
        !(
          operation === 'planner' &&
          (effect.operation === 'user-input' || effect.operation === 'planner-continuation')
        ))
    ) {
      throw new Error('integrity: reconciliation observation mismatch')
    }
  }
  if (
    effect.operation !== 'planner-continuation' &&
    (effect.terminalResultSequence === null ||
      payload.observationSequences.length !== 1 ||
      payload.observationSequences[0] !== effect.terminalResultSequence)
  ) {
    throw new Error('integrity: completed reconciliation must cite exact terminal result')
  }
}

function validateAttemptReconciliation(
  receipts: readonly Receipt[],
  currentSequence: number,
  payload: ReconciliationPayload,
  attempt: AttemptState,
): void {
  if (new Set(payload.observationSequences).size !== payload.observationSequences.length)
    throw new Error('integrity: duplicate reconciliation observation')
  if (payload.resolution === 'unknown') {
    if (payload.observationSequences.length !== 0)
      throw new Error('completion: non-completed reconciliation cannot cite observations')
    return
  }
  if (payload.resolution === 'not-submitted') {
    if (attempt.failureUncertainty !== 'before-submission' || attempt.inputObserved)
      throw new Error('lifecycle: confirmed delivery cannot reconcile not-submitted')
    if (payload.observationSequences.length !== 0)
      throw new Error('completion: non-completed reconciliation cannot cite observations')
    return
  }
  if (attempt.failureUncertainty !== 'after-submission')
    throw new Error('lifecycle: completed attempt reconciliation requires submitted transport')
  if (payload.observationSequences.length === 0)
    throw new Error('completion: completed reconciliation needs observations')
  for (const sequence of payload.observationSequences) {
    if (sequence >= currentSequence)
      throw new Error('integrity: reconciliation cites self or future')
    const observation = receipts[sequence - 1]
    if (
      !observation ||
      terminalOperation(observation.payload.event) === null ||
      !('attemptId' in observation.payload) ||
      observation.payload.attemptId !== payload.reservationId
    ) {
      throw new Error('integrity: attempt reconciliation observation mismatch')
    }
  }
}

export function replayRun(
  contextInput: ReplayContext,
  receiptInputs: readonly unknown[],
): ReplayResult {
  const context = normalizeReplayContext(contextInput)
  const receipts = receiptInputs.map((receipt) =>
    deepFreeze(parseReceipt(structuredClone(receipt))),
  )
  const attempts = new Map<string, AttemptState>()
  const effects = new Map<string, EffectState>()
  const conversationIds = new Set<string>()
  const requestIds = new Set<string>()
  let phase: ReplayResult['phase'] = 'PREPARED'
  let previous = computeGenesisHash(context)
  let firstFinalSequence: number | null = null
  let observedOverflow = false

  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index]
    if (receipt.sequence !== index + 1)
      throw new Error('integrity: receipt sequence gap or reorder')
    if (
      receipt.runId !== context.descriptor.runId ||
      receipt.manifestHash !== context.manifestHash
    ) {
      throw new Error('integrity: cross-run or manifest mismatch')
    }
    if (receipt.previousHash !== previous)
      throw new Error('integrity: receipt predecessor mismatch')
    const { receiptHash, ...unsigned } = receipt
    if (computeReceiptHash(unsigned) !== receiptHash)
      throw new Error('integrity: receipt hash mismatch')
    verifyCorrelation(receipt)
    previous = receipt.receiptHash
    const payload = receipt.payload

    if (phase === 'OBSERVATIONS_CLOSED')
      throw new Error('lifecycle: command after observations closed')
    if (payload.event === 'authorized') {
      if (phase !== 'PREPARED' || index !== 0)
        throw new Error('lifecycle: authorization must be first')
      if (
        payload.descriptorHash !== context.descriptorHash ||
        payload.manifestHash !== context.manifestHash ||
        payload.bindingsHash !== context.bindingsHash
      ) {
        throw new Error('integrity: authorization frozen identity mismatch')
      }
      phase = 'AUTHORIZED'
      continue
    }
    if (phase === 'PREPARED') throw new Error('lifecycle: authorization required')

    if (payload.event === 'attempt.reserved') {
      if (firstFinalSequence !== null) throw new Error('lifecycle: reservation after final')
      if (attempts.has(payload.attemptId)) throw new Error('lifecycle: duplicate attempt id')
      if (attempts.size >= context.manifest.budgets.maxTransportAttempts) {
        throw new Error('admission: transport attempt budget exhausted')
      }
      const priorAttempts = [...attempts.values()]
      if (priorAttempts.some((attempt) => attempt.inputObserved)) {
        throw new Error('admission: retry after confirmed USER_INPUT')
      }
      if (
        priorAttempts.length > 0 &&
        priorAttempts.some(
          (attempt) => !attempt.failureRecorded || attempt.reconciliation !== 'not-submitted',
        )
      ) {
        throw new Error('admission: overlapping or ineligible retry attempt')
      }
      attempts.set(payload.attemptId, {
        state: 'RESERVED',
        nonce: payload.nonce,
        processId: payload.processId,
        shellReady: false,
        trustAccepted: !context.descriptor.trustRequired,
        hostObserved: false,
        conversationId: null,
        inputObserved: false,
        failureRecorded: false,
        failureUncertainty: null,
        reconciliation: null,
      })
      phase = 'ACTIVE'
      continue
    }
    if (payload.event === 'effect.reconciled') {
      if (payload.reservationKind === 'attempt') {
        const attempt = requireAttempt(attempts, payload.reservationId)
        if (!attempt.failureRecorded || attempt.reconciliation !== null)
          throw new Error('lifecycle: duplicate or premature attempt reconciliation')
        validateAttemptReconciliation(receipts, receipt.sequence, payload, attempt)
        attempt.reconciliation = payload.resolution
        attempt.state = 'BLOCKED_ON_RECONCILIATION'
      } else {
        const effect = effects.get(payload.reservationId)
        if (
          effect?.state !== 'UNRESOLVED' ||
          effect.failureUncertainty === null ||
          effect.reconciliation !== null
        )
          throw new Error('lifecycle: duplicate or premature effect reconciliation')
        validateEffectReconciliation(receipts, receipt.sequence, payload, effect)
        effect.reconciliation = payload.resolution
        if (payload.resolution === 'completed') effect.state = 'COMPLETED'
        else if (payload.resolution === 'not-submitted') effect.state = 'NOT_SUBMITTED'
      }
      continue
    }
    if (payload.event === 'transport.failed') {
      const attempt = requireAttempt(attempts, payload.attemptId)
      if (attempt.reconciliation !== null)
        throw new Error('lifecycle: reconciled attempt rejects another failure')
      if (payload.effectId === null) {
        if (attempt.failureRecorded || attempt.reconciliation !== null || attempt.inputObserved) {
          throw new Error('lifecycle: duplicate or contradictory attempt failure')
        }
        const legal =
          (payload.uncertainty === 'before-submission' && attempt.state === 'RESERVED') ||
          (payload.uncertainty === 'after-submission' &&
            (attempt.state === 'READY' || attempt.state === 'RUNNING'))
        if (!legal) throw new Error('lifecycle: attempt failure delivery-stage mismatch')
        attempt.failureRecorded = true
        attempt.failureUncertainty = payload.uncertainty
        attempt.state = 'BLOCKED_ON_RECONCILIATION'
      } else {
        const effect = requireEffect(effects, payload.effectId, payload.attemptId)
        if (
          effect.failureUncertainty !== null ||
          effect.reconciliation !== null ||
          effect.state === 'COMPLETED'
        ) {
          throw new Error('lifecycle: duplicate or late effect failure')
        }
        const legal =
          (payload.uncertainty === 'before-submission' && effect.state === 'RESERVED') ||
          (payload.uncertainty === 'after-submission' && effect.state === 'SUBMITTED')
        if (!legal) throw new Error('lifecycle: effect failure submission mismatch')
        effect.failureUncertainty = payload.uncertainty
        effect.state = 'UNRESOLVED'
      }
      continue
    }
    if (payload.event === 'observations.closed') {
      const unresolved = [
        ...[...attempts]
          .filter(
            ([, attempt]) =>
              attempt.failureRecorded &&
              (attempt.reconciliation === null || attempt.reconciliation === 'unknown'),
          )
          .map(([id]) => `attempt:${id}`),
        ...[...effects]
          .filter(
            ([, effect]) =>
              effect.state === 'RESERVED' ||
              effect.state === 'UNRESOLVED' ||
              effect.state === 'CONTRADICTED' ||
              (effect.state === 'SUBMITTED' && effect.operation !== 'user-input'),
          )
          .map(([id]) => `effect:${id}`),
      ]
      if (unresolved.length > 0)
        throw new Error(`completion: unresolved reservations: ${unresolved.join(', ')}`)
      phase = 'OBSERVATIONS_CLOSED'
      continue
    }

    const attemptId = 'attemptId' in payload ? payload.attemptId : ''
    const attempt = requireAttempt(attempts, attemptId)
    const adverseDrain = [
      'planner.response',
      'tool.result',
      'retrieval.result',
      'provider.action',
      'provider.request',
      'memory.mutation',
    ].includes(payload.event)
    if (attempt.reconciliation === 'not-submitted')
      throw new Error('lifecycle: retired attempt requires a new reservation')
    if (attempt.reconciliation === 'completed' && !adverseDrain)
      throw new Error('lifecycle: completed failed attempt permits only adverse drain')
    if (
      attempt.failureRecorded &&
      (attempt.reconciliation === null || attempt.reconciliation === 'unknown') &&
      !adverseDrain
    ) {
      throw new Error('lifecycle: failed attempt permits only reconciliation or adverse drain')
    }
    if (payload.event === 'shell.ready') {
      if (attempt.shellReady) throw new Error('lifecycle: duplicate shell readiness')
      if (
        payload.nonce !== attempt.nonce ||
        payload.stdout !== attempt.nonce ||
        payload.shellProcessId !== attempt.processId ||
        payload.foregroundProcessId !== attempt.processId
      ) {
        throw new Error('lifecycle: shell readiness nonce or process identity mismatch')
      }
      attempt.shellReady = true
      attempt.state = 'READY'
      continue
    }
    if (!attempt.shellReady) throw new Error('lifecycle: shell readiness required')
    if (payload.event === 'trust.accepted') {
      if (!context.descriptor.trustRequired || attempt.trustAccepted)
        throw new Error('lifecycle: unexpected or duplicate trust acceptance')
      if (
        payload.workspacePath !== context.descriptor.workspacePath ||
        payload.workspaceDev !== context.descriptor.workspaceDev ||
        payload.workspaceIno !== context.descriptor.workspaceIno
      ) {
        throw new Error('lifecycle: trust workspace identity mismatch')
      }
      attempt.trustAccepted = true
      continue
    }
    if (payload.event === 'host.observed') {
      if (!attempt.trustAccepted || attempt.hostObserved)
        throw new Error('lifecycle: trust required before unique host observation')
      const prior = receipts.find(
        (
          candidate,
        ): candidate is Receipt & {
          payload: Extract<ReceiptPayload, { event: 'host.observed' }>
        } => candidate.payload.event === 'host.observed',
      )
      if (
        prior &&
        (prior.payload.agyVersion !== payload.agyVersion ||
          prior.payload.model !== payload.model ||
          prior.payload.effort !== payload.effort)
      )
        throw new Error('lifecycle: conflicting host identities')
      attempt.hostObserved = true
      continue
    }
    if (!attempt.trustAccepted || !attempt.hostObserved)
      throw new Error('lifecycle: trust and host observation required')

    if (payload.event === 'effect.reserved') {
      if (firstFinalSequence !== null)
        throw new Error('lifecycle: new effect reservation after final')
      if (observedOverflow)
        throw new Error('admission: observed budget overflow blocks reservation')
      if (effects.has(payload.effectId)) throw new Error('lifecycle: duplicate effect id')
      if (
        [...effects.values()].some(
          (effect) =>
            effect.state === 'RESERVED' ||
            effect.state === 'UNRESOLVED' ||
            effect.state === 'CONTRADICTED',
        )
      ) {
        throw new Error('admission: unresolved effect blocks reservation')
      }
      const reserved = [...effects.values()]
      const operationCount = reserved.filter(
        (effect) => effect.operation === payload.operation,
      ).length
      const toolCount = reserved.filter(
        (effect) => effect.operation === 'tool' || effect.operation === 'retrieval',
      ).length
      const limit = {
        'conversation-create': context.manifest.budgets.maxCreatedConversations,
        'user-input': 1,
        'planner-continuation': context.manifest.budgets.maxPlannerContinuations,
        tool: context.manifest.budgets.maxToolCalls,
        retrieval: context.manifest.budgets.maxSearchCalls,
      }[payload.operation]
      if (operationCount >= limit)
        throw new Error(`admission: ${payload.operation} budget exhausted`)
      if (
        (payload.operation === 'tool' || payload.operation === 'retrieval') &&
        toolCount >= context.manifest.budgets.maxToolCalls
      ) {
        throw new Error('admission: tool budget exhausted')
      }
      if (payload.operation === 'conversation-create' && attempt.conversationId !== null)
        throw new Error('lifecycle: one conversation per attempt')
      if (payload.operation !== 'conversation-create' && attempt.conversationId === null)
        throw new Error('lifecycle: conversation required before effect')
      if (payload.operation === 'user-input' && attempt.inputObserved)
        throw new Error('lifecycle: confirmed USER_INPUT cannot be resent')
      effects.set(payload.effectId, {
        attemptId,
        operation: payload.operation,
        state: 'RESERVED',
        observationSequences: [],
        submitted: false,
        failureUncertainty: null,
        terminalResultSequence: null,
        reconciliation: null,
      })
      continue
    }
    if (payload.event === 'effect.submitted') {
      if (firstFinalSequence !== null) throw new Error('lifecycle: effect submission after final')
      const effect = requireEffect(effects, payload.effectId, attemptId)
      if (effect.state !== 'RESERVED')
        throw new Error('lifecycle: effect submission requires reservation')
      effect.submitted = true
      effect.state = 'SUBMITTED'
      continue
    }

    if (!('effectId' in payload)) throw new Error('lifecycle: unsupported command')
    const effect = requireEffect(effects, payload.effectId, attemptId)
    const drainObservation =
      payload.event === 'planner.response' ||
      payload.event === 'provider.action' ||
      payload.event === 'provider.request' ||
      payload.event === 'memory.mutation'
    const contradictionObservation =
      effect.state === 'NOT_SUBMITTED' || effect.state === 'CONTRADICTED'
    if (
      effect.state !== 'SUBMITTED' &&
      effect.state !== 'UNRESOLVED' &&
      !(effect.state === 'COMPLETED' && drainObservation) &&
      !contradictionObservation
    ) {
      throw new Error('lifecycle: result requires submitted or drainable reservation')
    }
    const unresolvedAtObservation = effect.state === 'UNRESOLVED'
    if (
      'conversationId' in payload &&
      attempt.conversationId !== null &&
      payload.conversationId !== attempt.conversationId
    ) {
      throw new Error('lifecycle: cross-conversation result')
    }
    const singleTerminalObservation = [
      'conversation.created',
      'user-input.observed',
      'tool.result',
      'retrieval.result',
    ].includes(payload.event)
    if (singleTerminalObservation && effect.terminalResultSequence !== null)
      throw new Error('lifecycle: duplicate terminal result for effect')
    if (contradictionObservation) {
      const operation = terminalOperation(payload.event)
      if (
        operation !== null &&
        operation !== effect.operation &&
        !(
          operation === 'planner' &&
          (effect.operation === 'user-input' || effect.operation === 'planner-continuation')
        )
      ) {
        throw new Error('lifecycle: contradictory observation operation mismatch')
      }
      if (payload.event === 'provider.request') {
        if (requestIds.has(payload.requestId))
          throw new Error('lifecycle: duplicate provider request id')
        requestIds.add(payload.requestId)
      }
      effect.observationSequences.push(receipt.sequence)
      if (singleTerminalObservation) effect.terminalResultSequence = receipt.sequence
      effect.state = 'CONTRADICTED'
      continue
    }
    effect.observationSequences.push(receipt.sequence)
    if (singleTerminalObservation) effect.terminalResultSequence = receipt.sequence
    if (payload.event === 'conversation.created') {
      if (
        effect.operation !== 'conversation-create' ||
        attempt.conversationId !== null ||
        conversationIds.has(payload.conversationId)
      ) {
        throw new Error('lifecycle: invalid or duplicate conversation creation')
      }
      conversationIds.add(payload.conversationId)
      attempt.conversationId = payload.conversationId
      attempt.state = 'RUNNING'
      if (!unresolvedAtObservation) effect.state = 'COMPLETED'
    } else if (payload.event === 'user-input.observed') {
      if (attempt.inputObserved) throw new Error('lifecycle: confirmed USER_INPUT cannot be resent')
      if (
        effect.operation !== 'user-input' ||
        payload.promptHash !== context.bindings.promptHash ||
        payload.taskId !== context.manifest.taskId
      ) {
        throw new Error('lifecycle: USER_INPUT reservation or frozen identity mismatch')
      }
      attempt.inputObserved = true
    } else if (payload.event === 'planner.response') {
      if (!attempt.inputObserved) throw new Error('lifecycle: planner response before USER_INPUT')
      if (!['user-input', 'planner-continuation'].includes(effect.operation))
        throw new Error('lifecycle: planner response operation mismatch')
      if (payload.kind === 'final' && firstFinalSequence === null)
        firstFinalSequence = receipt.sequence
      if (!unresolvedAtObservation) effect.state = 'COMPLETED'
    } else if (payload.event === 'tool.result') {
      if (effect.operation !== 'tool') throw new Error('lifecycle: tool result operation mismatch')
      if (!unresolvedAtObservation) effect.state = 'COMPLETED'
    } else if (payload.event === 'retrieval.result') {
      if (effect.operation !== 'retrieval')
        throw new Error('lifecycle: retrieval result operation mismatch')
      if (!unresolvedAtObservation) effect.state = 'COMPLETED'
      const results = receipts
        .slice(0, index + 1)
        .filter(
          (
            candidate,
          ): candidate is Receipt & {
            payload: Extract<ReceiptPayload, { event: 'retrieval.result' }>
          } => candidate.payload.event === 'retrieval.result',
        )
        .map((candidate) => ({
          sequence: candidate.sequence,
          query: candidate.payload.query,
          owner: candidate.payload.owner,
          source: candidate.payload.source,
          success: candidate.payload.success,
          content: candidate.payload.content,
        }))
      const accounting = deriveRetrievalAccounting(context.manifest, results)
      observedOverflow =
        accounting.returnedBytes > context.manifest.budgets.maxReturnedBytes ||
        accounting.noProgressSteps > context.manifest.budgets.maxNoProgressSteps ||
        accounting.repeatedQueries > context.manifest.budgets.maxRepeatedQueries
    } else if (payload.event === 'provider.request') {
      if (requestIds.has(payload.requestId))
        throw new Error('lifecycle: duplicate provider request id')
      requestIds.add(payload.requestId)
    }
  }

  const unresolvedReservations = [
    ...[...attempts]
      .filter(
        ([, attempt]) =>
          attempt.failureRecorded &&
          (attempt.reconciliation === null || attempt.reconciliation === 'unknown'),
      )
      .map(([id]) => `attempt:${id}`),
    ...[...effects]
      .filter(
        ([, effect]) =>
          effect.state === 'RESERVED' ||
          effect.state === 'UNRESOLVED' ||
          effect.state === 'CONTRADICTED' ||
          (effect.state === 'SUBMITTED' && effect.operation !== 'user-input'),
      )
      .map(([id]) => `effect:${id}`),
  ]
  const result = deepFreeze<ReplayResult>({
    valid: true,
    context,
    receipts,
    phase,
    unresolvedReservations,
    firstFinalSequence,
  })
  validatedReplays.add(result)
  return result
}

export function deriveHostEvidence(replay: ReplayResult): DerivedHostEvidence {
  if (!validatedReplays.has(replay))
    return { status: 'invalid', failures: ['replay was not produced by replayRun'] }
  if (replay.phase !== 'OBSERVATIONS_CLOSED')
    return { status: 'incomplete', reasons: ['observations are not closed'] }
  if (replay.unresolvedReservations.length > 0)
    return { status: 'incomplete', reasons: ['unresolved reservations remain'] }
  const hostReceipts = replay.receipts.filter(
    (
      receipt,
    ): receipt is Receipt & { payload: Extract<ReceiptPayload, { event: 'host.observed' }> } =>
      receipt.payload.event === 'host.observed',
  )
  const finalReceipts = replay.receipts.filter(
    (
      receipt,
    ): receipt is Receipt & { payload: Extract<ReceiptPayload, { event: 'planner.response' }> } =>
      receipt.payload.event === 'planner.response' && receipt.payload.kind === 'final',
  )
  const inputReceipts = replay.receipts.filter(
    (
      receipt,
    ): receipt is Receipt & {
      payload: Extract<ReceiptPayload, { event: 'user-input.observed' }>
    } => receipt.payload.event === 'user-input.observed',
  )
  const close = replay.receipts.at(-1)?.payload
  if (hostReceipts.length === 0) return { status: 'incomplete', reasons: ['host identity missing'] }
  if (finalReceipts.length === 0)
    return { status: 'incomplete', reasons: ['final response missing'] }
  if (inputReceipts.length === 0) return { status: 'incomplete', reasons: ['USER_INPUT missing'] }
  if (close?.event !== 'observations.closed')
    return { status: 'invalid', failures: ['close receipt missing'] }
  const host = hostReceipts[0].payload
  const firstFinal = finalReceipts[0]
  if (firstFinal.payload.response === null)
    return { status: 'invalid', failures: ['final response payload missing'] }
  const retrievalResults = replay.receipts
    .filter(
      (
        receipt,
      ): receipt is Receipt & { payload: Extract<ReceiptPayload, { event: 'retrieval.result' }> } =>
        receipt.payload.event === 'retrieval.result',
    )
    .map((receipt) => ({
      sequence: receipt.sequence,
      query: receipt.payload.query,
      owner: receipt.payload.owner,
      source: receipt.payload.source,
      success: receipt.payload.success,
      content: receipt.payload.content,
    }))
  const derived = deriveRetrievalAccounting(replay.context.manifest, retrievalResults)
  const plannerResponses = replay.receipts.filter(
    (
      receipt,
    ): receipt is Receipt & {
      payload: Extract<ReceiptPayload, { event: 'planner.response' }>
    } => receipt.payload.event === 'planner.response',
  )
  const reservedOperations = new Map(
    replay.receipts
      .filter(
        (
          receipt,
        ): receipt is Receipt & {
          payload: Extract<ReceiptPayload, { event: 'effect.reserved' }>
        } => receipt.payload.event === 'effect.reserved',
      )
      .map((receipt) => [receipt.payload.effectId, receipt.payload.operation]),
  )
  const submittedOperations = replay.receipts
    .filter(
      (
        receipt,
      ): receipt is Receipt & {
        payload: Extract<ReceiptPayload, { event: 'effect.submitted' }>
      } => receipt.payload.event === 'effect.submitted',
    )
    .map((receipt) => reservedOperations.get(receipt.payload.effectId))
  const evidenceInput: HostEvidence = {
    schemaVersion: 1,
    cellId: replay.context.manifest.cellId,
    manifestHash: replay.context.manifestHash,
    promptHash: replay.context.bindings.promptHash,
    actualHost: { agyVersion: host.agyVersion, model: host.model, effort: host.effort },
    finalResponse: firstFinal.payload.response,
    terminal: {
      isTerminal: true,
      finalResponseSequence: firstFinal.sequence,
      finalResponseCount: finalReceipts.length,
      intermediateCompletionCount: plannerResponses.filter(
        (receipt) => receipt.payload.kind === 'intermediate',
      ).length,
    },
    userInput: {
      structured: inputReceipts[0].payload.structured,
      taskId: inputReceipts[0].payload.taskId,
    },
    protocolFacts: {
      memoryMutationObserved: replay.receipts.some(
        (receipt) => receipt.payload.event === 'memory.mutation',
      ),
      liveHostExecutionObserved: hostReceipts.length > 0,
      providerActionObserved: replay.receipts.some(
        (receipt) =>
          receipt.payload.event === 'provider.action' ||
          receipt.payload.event === 'provider.request',
      ),
    },
    accounting: {
      transportAttempts: replay.receipts.filter(
        (receipt) => receipt.payload.event === 'attempt.reserved',
      ).length,
      createdConversations: replay.receipts.filter(
        (receipt) => receipt.payload.event === 'conversation.created',
      ).length,
      scoredUserInputs: inputReceipts.length,
      plannerResponses: plannerResponses.length,
      plannerContinuations: submittedOperations.filter(
        (operation) => operation === 'planner-continuation',
      ).length,
      toolCalls: submittedOperations.filter(
        (operation) => operation === 'tool' || operation === 'retrieval',
      ).length,
      ...derived,
      providerRequests:
        close.providerRequestVisibility === 'complete'
          ? replay.receipts.filter((receipt) => receipt.payload.event === 'provider.request').length
          : 'unavailable',
    },
    transcript: {
      truncated: close.captureTruncated,
      truncatedFields: close.truncatedFields,
      providerInputBytes: 'unavailable',
    },
    retrievalResults,
  }
  try {
    return { status: 'ready', evidence: parseHostEvidence(evidenceInput, replay.context.manifest) }
  } catch (error) {
    return {
      status: 'invalid',
      failures: [error instanceof Error ? error.message : 'evidence parse failed'],
    }
  }
}
