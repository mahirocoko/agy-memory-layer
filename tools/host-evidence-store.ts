import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  computeManifestHash,
  type FrozenContractBindings,
  type HostEvidence,
  type HostEvidenceManifest,
  type HostEvidenceScore,
  parseFrozenContractBindings,
  parseHostEvidence,
  scoreHostEvidence,
  stableJson,
} from './host-evidence-contract.ts'
import {
  computeGenesisHash,
  computeReceiptHash,
  createReceipt,
  deriveHostEvidence,
  hashCanonical,
  normalizeReplayContext,
  parseReceipt,
  parseRunDescriptor,
  type Receipt,
  type ReceiptPayload,
  type ReplayContext,
  type RunDescriptor,
  replayRun,
  validatePhase2Manifest,
} from './host-evidence-receipts.ts'

export const RUN_PREFIX = 'host-evidence-v1-'
const MAX_FILE_BYTES = 256 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024
const MAX_RECEIPTS = 256
const MAX_JSON_DEPTH = 32
const RECEIPT_PATTERN = /^receipt-([0-9]{6})\.json$/
declare const handleBrand: unique symbol

type OwnerLock = { schemaVersion: 1; ownerId: string; sessionToken: string }
type FilePin = { dev: number; ino: number; size: number; hash: string }
type PrivateRunState = {
  rootDev: number
  rootIno: number
  descriptor: RunDescriptor
  manifest: HostEvidenceManifest
  bindings: FrozenContractBindings
  lock: OwnerLock
  immutablePins: Record<string, FilePin>
  receiptCount: number
  receiptHead: string
  poisoned: boolean
  sealed: boolean
  disposed: boolean
  mutating: boolean
}

const privateRuns = new WeakMap<object, PrivateRunState>()

function freezeDeep<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) freezeDeep(entry)
    Object.freeze(value)
  }
  return value
}

export type RunCheckpoint = {
  schemaVersion: 1
  runId: string
  receiptCount: number
  receiptHead: string
  evidenceHash: string
  scoreHash: string
  sealHash: string
}

type RunSeal = {
  schemaVersion: 1
  runId: string
  descriptorHash: string
  manifestHash: string
  bindingsHash: string
  receiptCount: number
  receiptHead: string
  evidenceHash: string
  scoreHash: string
}

export type RunHandle = {
  readonly root: string
  readonly workspace: string
  readonly descriptor: RunDescriptor
  readonly bindings: FrozenContractBindings
  readonly ownerId: string
  readonly [handleBrand]: true
}

export type RunInspection = {
  root: string
  descriptor: RunDescriptor
  manifest: HostEvidenceManifest
  bindings: FrozenContractBindings
  receipts: Receipt[]
  context: ReplayContext
  sealed: boolean
}

type InternalInspection = RunInspection & {
  lock: OwnerLock
  rootStat: fs.Stats
  immutablePins: Record<string, FilePin>
}

export type DispatchTransport = (
  persisted: Receipt,
) => ReceiptPayload | readonly ReceiptPayload[] | undefined

function requirePosix(): { uid: number; gid: number } {
  if (
    typeof process.getuid !== 'function' ||
    typeof process.getgid !== 'function' ||
    path.sep !== '/'
  ) {
    throw new Error('filesystem boundary: host-evidence store is POSIX-only')
  }
  return { uid: process.getuid(), gid: process.getgid() }
}

function canonicalTemp(): string {
  return fs.realpathSync(os.tmpdir())
}

function assertCanonicalRoot(rootInput: string): string {
  if (!path.isAbsolute(rootInput)) throw new Error('filesystem boundary: run root must be absolute')
  const root = path.resolve(rootInput)
  if (path.dirname(root) !== canonicalTemp() || !path.basename(root).startsWith(RUN_PREFIX)) {
    throw new Error('filesystem boundary: run root must be a direct prefixed child of system temp')
  }
  if (fs.realpathSync(root) !== root)
    throw new Error('filesystem boundary: run root replacement or alias')
  return root
}

function assertDirectory(
  target: string,
  mode: number,
  uid: number,
  gid: number,
  label: string,
): fs.Stats {
  const stat = fs.lstatSync(target)
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`filesystem boundary: ${label} is not a directory`)
  if ((stat.mode & 0o777) !== mode) throw new Error(`filesystem boundary: ${label} mode drift`)
  if (stat.uid !== uid || stat.gid !== gid)
    throw new Error(`filesystem boundary: ${label} owner drift`)
  return stat
}

function jsonDepth(value: unknown, depth = 0): number {
  if (depth > MAX_JSON_DEPTH) throw new Error('representation: JSON nesting exceeds limit')
  if (Array.isArray(value))
    return Math.max(depth, ...value.map((entry) => jsonDepth(entry, depth + 1)))
  if (typeof value === 'object' && value !== null) {
    return Math.max(
      depth,
      ...Object.values(value as Record<string, unknown>).map((entry) =>
        jsonDepth(entry, depth + 1),
      ),
    )
  }
  return depth
}

function canonicalBytes(value: unknown): Buffer {
  jsonDepth(value)
  const bytes = Buffer.from(stableJson(value), 'utf8')
  if (bytes.length > MAX_FILE_BYTES)
    throw new Error('representation: canonical file exceeds byte limit')
  return bytes
}

function sameStat(left: fs.Stats, right: fs.Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.nlink === right.nlink &&
    (left.mode & 0o777) === (right.mode & 0o777)
  )
}

function readCanonical(
  target: string,
  uid: number,
  gid: number,
  label: string,
): { value: unknown; pin: FilePin } {
  const pathStat = fs.lstatSync(target)
  if (!pathStat.isFile() || pathStat.isSymbolicLink())
    throw new Error(`filesystem boundary: ${label} is not regular`)
  const flags =
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)
  const descriptor = fs.openSync(target, flags)
  try {
    const before = fs.fstatSync(descriptor)
    if (!sameStat(pathStat, before) || !before.isFile())
      throw new Error(`filesystem boundary: ${label} identity changed during open`)
    if ((before.mode & 0o777) !== 0o600) throw new Error(`filesystem boundary: ${label} mode drift`)
    if (before.uid !== uid || before.gid !== gid)
      throw new Error(`filesystem boundary: ${label} owner drift`)
    if (before.nlink !== 1) throw new Error(`filesystem boundary: ${label} link count drift`)
    if (before.size > MAX_FILE_BYTES) throw new Error(`representation: ${label} exceeds byte limit`)
    const bytes = Buffer.alloc(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count === 0) throw new Error(`filesystem boundary: ${label} short read`)
      offset += count
    }
    const after = fs.fstatSync(descriptor)
    if (!sameStat(before, after))
      throw new Error(`filesystem boundary: ${label} changed during read`)
    let source: string
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new Error(`representation: ${label} malformed UTF-8`)
    }
    let value: unknown
    try {
      value = JSON.parse(source) as unknown
    } catch {
      throw new Error(`representation: ${label} malformed JSON`)
    }
    jsonDepth(value)
    if (!bytes.equals(Buffer.from(stableJson(value), 'utf8')))
      throw new Error(`representation: ${label} is not exact canonical JSON`)
    return {
      value,
      pin: {
        dev: before.dev,
        ino: before.ino,
        size: before.size,
        hash: createHash('sha256').update(bytes).digest('hex'),
      },
    }
  } finally {
    fs.closeSync(descriptor)
  }
}

function syncDirectory(root: string): void {
  const descriptor = fs.openSync(root, fs.constants.O_RDONLY)
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

function publishExclusive(root: string, name: string, value: unknown): void {
  if (name.includes('/') || name === '.' || name === '..')
    throw new Error('filesystem boundary: invalid flat filename')
  const target = path.join(root, name)
  const temporary = path.join(root, `.publish-${randomUUID()}`)
  const bytes = canonicalBytes(value)
  const persistedBytes = fs.readdirSync(root).reduce((total, entry) => {
    const stat = fs.lstatSync(path.join(root, entry))
    return total + (stat.isFile() ? stat.size : 0)
  }, 0)
  if (persistedBytes + bytes.length > MAX_TOTAL_BYTES)
    throw new Error('representation: run exceeds total byte limit')
  let descriptor: number | null = null
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    )
    fs.fchmodSync(descriptor, 0o600)
    fs.writeFileSync(descriptor, bytes)
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = null
    fs.linkSync(temporary, target)
    fs.unlinkSync(temporary)
    syncDirectory(root)
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor)
    try {
      fs.unlinkSync(temporary)
    } catch {
      // Only an unpublished temporary inode in the active fresh root is removed.
    }
    throw error
  }
}

function parseOwnerLock(value: unknown): OwnerLock {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('owner lock: expected object')
  const input = value as Record<string, unknown>
  if (Object.keys(input).sort().join(',') !== 'ownerId,schemaVersion,sessionToken')
    throw new TypeError('owner lock: unexpected keys')
  if (
    input.schemaVersion !== 1 ||
    typeof input.ownerId !== 'string' ||
    typeof input.sessionToken !== 'string' ||
    input.ownerId.length < 1 ||
    input.ownerId.length > 128 ||
    input.sessionToken.length < 16 ||
    input.sessionToken.length > 128
  ) {
    throw new TypeError('owner lock: invalid fields')
  }
  return { schemaVersion: 1, ownerId: input.ownerId, sessionToken: input.sessionToken }
}

function receiptName(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > MAX_RECEIPTS)
    throw new Error('admission: receipt count limit')
  return `receipt-${String(sequence).padStart(6, '0')}.json`
}

function inspectRoot(rootInput: string): InternalInspection {
  const root = assertCanonicalRoot(rootInput)
  const current = requirePosix()
  const rootStat = assertDirectory(root, 0o700, current.uid, current.gid, 'run root')
  const entries = fs.readdirSync(root).sort()
  if (entries.some((entry) => entry.startsWith('.publish-')))
    throw new Error('filesystem boundary: partial publish residue')
  const receiptEntries = entries.filter((entry) => RECEIPT_PATTERN.test(entry))
  if (receiptEntries.length > MAX_RECEIPTS)
    throw new Error('representation: receipt count exceeds limit')
  const sealed = entries.includes('seal.json')
  const expected = new Set([
    'workspace',
    'descriptor.json',
    'manifest.json',
    'bindings.json',
    'owner-lock.json',
    ...receiptEntries,
  ])
  if (sealed) for (const name of ['evidence.json', 'score.json', 'seal.json']) expected.add(name)
  const unknown = entries.filter((entry) => !expected.has(entry))
  if (unknown.length > 0)
    throw new Error(`filesystem boundary: unknown entries: ${unknown.join(', ')}`)
  const total = entries.reduce((sum, entry) => {
    const stat = fs.lstatSync(path.join(root, entry))
    return sum + (stat.isFile() ? stat.size : 0)
  }, 0)
  if (total > MAX_TOTAL_BYTES) throw new Error('representation: run exceeds total byte limit')

  const descriptorRead = readCanonical(
    path.join(root, 'descriptor.json'),
    current.uid,
    current.gid,
    'descriptor.json',
  )
  const descriptor = parseRunDescriptor(descriptorRead.value)
  if (
    descriptor.uid !== current.uid ||
    descriptor.gid !== current.gid ||
    descriptor.rootDev !== rootStat.dev ||
    descriptor.rootIno !== rootStat.ino ||
    stableJson(descriptor.limits) !==
      stableJson({
        maxFileBytes: MAX_FILE_BYTES,
        maxTotalBytes: MAX_TOTAL_BYTES,
        maxReceipts: MAX_RECEIPTS,
        maxJsonDepth: MAX_JSON_DEPTH,
      })
  )
    throw new Error('filesystem boundary: frozen descriptor root, owner, or limits drift')
  const workspace = path.join(root, 'workspace')
  const workspaceStat = assertDirectory(
    workspace,
    0o700,
    descriptor.uid,
    descriptor.gid,
    'workspace',
  )
  if (
    fs.realpathSync(workspace) !== descriptor.workspacePath ||
    workspaceStat.dev !== descriptor.workspaceDev ||
    workspaceStat.ino !== descriptor.workspaceIno
  ) {
    throw new Error('filesystem boundary: workspace replacement or identity drift')
  }
  const manifestRead = readCanonical(
    path.join(root, 'manifest.json'),
    descriptor.uid,
    descriptor.gid,
    'manifest.json',
  )
  const bindingsRead = readCanonical(
    path.join(root, 'bindings.json'),
    descriptor.uid,
    descriptor.gid,
    'bindings.json',
  )
  const lockRead = readCanonical(
    path.join(root, 'owner-lock.json'),
    descriptor.uid,
    descriptor.gid,
    'owner-lock.json',
  )
  const manifest = validatePhase2Manifest(manifestRead.value)
  const bindings = parseFrozenContractBindings(bindingsRead.value)
  const lock = parseOwnerLock(lockRead.value)
  const manifestHash = computeManifestHash(manifest)
  const context = normalizeReplayContext({
    descriptor,
    manifest,
    bindings,
    descriptorHash: hashCanonical('host-evidence-descriptor-v1', descriptor),
    manifestHash,
    bindingsHash: hashCanonical('host-evidence-bindings-v1', bindings),
    lockHash: hashCanonical('host-evidence-owner-lock-v1', lock),
  })
  const receipts = receiptEntries.map((name, index) => {
    if (name !== receiptName(index + 1))
      throw new Error('integrity: receipt filename gap or rename')
    return parseReceipt(
      readCanonical(path.join(root, name), descriptor.uid, descriptor.gid, name).value,
    )
  })
  if (receipts.length > 0) replayRun(context, receipts)
  return {
    root,
    descriptor,
    manifest,
    bindings,
    receipts,
    context,
    sealed,
    lock,
    rootStat,
    immutablePins: {
      'descriptor.json': descriptorRead.pin,
      'manifest.json': manifestRead.pin,
      'bindings.json': bindingsRead.pin,
      'owner-lock.json': lockRead.pin,
    },
  }
}

function privateState(handle: RunHandle): PrivateRunState {
  const state = privateRuns.get(handle)
  if (!state) throw new Error('ownership: forged or cloned run handle')
  return state
}

function samePin(left: FilePin, right: FilePin): boolean {
  return stableJson(left) === stableJson(right)
}

function requireActive(
  handle: RunHandle,
  mutationRequested: boolean,
  allowLocalSeal = false,
): InternalInspection {
  const state = privateState(handle)
  if (state.disposed) throw new Error('ownership: inactive run handle')
  if (state.poisoned) throw new Error('ownership: poisoned run handle')
  if (state.sealed && !allowLocalSeal) throw new Error('seal: run is sealed')
  const inspection = inspectRoot(handle.root)
  if (mutationRequested && inspection.sealed && !state.sealed)
    throw new Error('seal: external seal blocks mutation')
  if (inspection.rootStat.dev !== state.rootDev || inspection.rootStat.ino !== state.rootIno)
    throw new Error('filesystem boundary: root replacement')
  if (
    stableJson(inspection.descriptor) !== stableJson(state.descriptor) ||
    stableJson(inspection.manifest) !== stableJson(state.manifest) ||
    stableJson(inspection.bindings) !== stableJson(state.bindings) ||
    stableJson(inspection.lock) !== stableJson(state.lock)
  )
    throw new Error('integrity: immutable active identity drift')
  for (const [name, pin] of Object.entries(state.immutablePins)) {
    if (!samePin(pin, inspection.immutablePins[name]))
      throw new Error(`integrity: immutable inode or content drift: ${name}`)
  }
  const diskHead = inspection.receipts.at(-1)?.receiptHash ?? computeGenesisHash(inspection.context)
  if (inspection.receipts.length !== state.receiptCount || diskHead !== state.receiptHead) {
    throw new Error('integrity: active receipt checkpoint drift')
  }
  return inspection
}

function mutation<T>(handle: RunHandle, operation: (state: PrivateRunState) => T): T {
  const state = privateState(handle)
  if (state.mutating) throw new Error('ownership: concurrent mutation rejected')
  state.mutating = true
  try {
    return operation(state)
  } finally {
    state.mutating = false
  }
}

export function createRun(
  manifestInput: unknown,
  options: { ownerId?: string; trustRequired?: boolean } = {},
): RunHandle {
  const identity = requirePosix()
  const manifest = validatePhase2Manifest(manifestInput)
  const root = fs.mkdtempSync(path.join(canonicalTemp(), RUN_PREFIX))
  fs.chmodSync(root, 0o700)
  try {
    const rootStat = assertDirectory(root, 0o700, identity.uid, identity.gid, 'run root')
    const workspace = path.join(root, 'workspace')
    fs.mkdirSync(workspace, { mode: 0o700 })
    fs.chmodSync(workspace, 0o700)
    const workspaceStat = assertDirectory(workspace, 0o700, identity.uid, identity.gid, 'workspace')
    const descriptor: RunDescriptor = {
      schemaVersion: 1,
      runId: `run-${randomUUID()}`,
      rootDev: rootStat.dev,
      rootIno: rootStat.ino,
      workspacePath: fs.realpathSync(workspace),
      workspaceDev: workspaceStat.dev,
      workspaceIno: workspaceStat.ino,
      uid: identity.uid,
      gid: identity.gid,
      trustRequired: options.trustRequired ?? false,
      scope: 'offline-only',
      limits: {
        maxFileBytes: MAX_FILE_BYTES,
        maxTotalBytes: MAX_TOTAL_BYTES,
        maxReceipts: MAX_RECEIPTS,
        maxJsonDepth: MAX_JSON_DEPTH,
      },
    }
    const manifestHash = computeManifestHash(manifest)
    const bindings: FrozenContractBindings = {
      manifestHash,
      promptHash: manifest.promptHash,
      answerKeyHash: manifest.answerKeyHash,
      scorerHash: manifest.scorerHash,
    }
    const lock: OwnerLock = {
      schemaVersion: 1,
      ownerId: options.ownerId ?? `owner-${randomUUID()}`,
      sessionToken: randomUUID(),
    }
    publishExclusive(root, 'descriptor.json', descriptor)
    publishExclusive(root, 'manifest.json', manifest)
    publishExclusive(root, 'bindings.json', bindings)
    publishExclusive(root, 'owner-lock.json', lock)
    const inspection = inspectRoot(root)
    const publicHandle = freezeDeep({
      root,
      workspace,
      descriptor: structuredClone(descriptor),
      bindings: structuredClone(bindings),
      ownerId: lock.ownerId,
    }) as RunHandle
    privateRuns.set(publicHandle, {
      rootDev: rootStat.dev,
      rootIno: rootStat.ino,
      descriptor: structuredClone(descriptor),
      manifest: structuredClone(manifest),
      bindings: structuredClone(bindings),
      lock: structuredClone(lock),
      immutablePins: structuredClone(inspection.immutablePins),
      receiptCount: 0,
      receiptHead: computeGenesisHash(inspection.context),
      poisoned: false,
      sealed: false,
      disposed: false,
      mutating: false,
    })
    return publicHandle
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true })
    throw error
  }
}

export function inspectRun(run: RunHandle | string): RunInspection {
  const inspection = typeof run === 'string' ? inspectRoot(run) : requireActive(run, false, true)
  const { lock: _lock, rootStat: _rootStat, immutablePins: _pins, ...publicInspection } = inspection
  return publicInspection
}

function append(handle: RunHandle, state: PrivateRunState, payload: ReceiptPayload): Receipt {
  const inspection = requireActive(handle, true)
  if (inspection.receipts.length >= MAX_RECEIPTS) throw new Error('admission: receipt count limit')
  const receipt = createReceipt(inspection.context, inspection.receipts.at(-1) ?? null, payload)
  replayRun(inspection.context, [...inspection.receipts, receipt])
  try {
    publishExclusive(handle.root, receiptName(receipt.sequence), receipt)
    const persisted = inspectRoot(handle.root)
    if (
      persisted.receipts.length !== state.receiptCount + 1 ||
      persisted.receipts.at(-1)?.receiptHash !== receipt.receiptHash
    ) {
      throw new Error('integrity: persisted receipt checkpoint mismatch')
    }
    state.receiptCount = persisted.receipts.length
    state.receiptHead = receipt.receiptHash
  } catch (error) {
    state.poisoned = true
    throw new Error('integrity: receipt persistence failed; handle poisoned', { cause: error })
  }
  return receipt
}

export function dispatch(
  handle: RunHandle,
  payload: ReceiptPayload,
  transport?: DispatchTransport,
): Receipt {
  return mutation(handle, (state) => {
    const persisted = append(handle, state, payload)
    if (transport) {
      const output = transport(persisted)
      const commands = output === undefined ? [] : Array.isArray(output) ? output : [output]
      for (const command of commands) append(handle, state, command)
    }
    return persisted
  })
}

export function authorizeRun(handle: RunHandle): Receipt {
  const inspection = requireActive(handle, true)
  return dispatch(handle, {
    event: 'authorized',
    descriptorHash: inspection.context.descriptorHash,
    manifestHash: inspection.context.manifestHash,
    bindingsHash: inspection.context.bindingsHash,
    scope: 'offline-only',
  })
}

function scoreHash(score: HostEvidenceScore): string {
  return hashCanonical('host-evidence-score-v1', score)
}

export function sealRun(handle: RunHandle): {
  checkpoint: RunCheckpoint
  evidence: HostEvidence
  score: HostEvidenceScore
} {
  return mutation(handle, (state) => {
    const inspection = requireActive(handle, true)
    if (inspection.receipts.length === 0)
      throw new Error('completion: authorization receipt missing')
    const derived = deriveHostEvidence(replayRun(inspection.context, inspection.receipts))
    if (derived.status !== 'ready')
      throw new Error(
        `completion: evidence ${derived.status}: ${'reasons' in derived ? derived.reasons.join(', ') : derived.failures.join(', ')}`,
      )
    const evidence = parseHostEvidence(derived.evidence, inspection.manifest)
    const score = scoreHostEvidence(inspection.manifest, evidence, inspection.bindings)
    const head = inspection.receipts.at(-1)
    if (!head) throw new Error('completion: receipt head missing')
    const evidenceHash = hashCanonical('host-evidence-evidence-v1', evidence)
    const computedScoreHash = scoreHash(score)
    const seal: RunSeal = {
      schemaVersion: 1,
      runId: inspection.descriptor.runId,
      descriptorHash: inspection.context.descriptorHash,
      manifestHash: inspection.context.manifestHash,
      bindingsHash: inspection.context.bindingsHash,
      receiptCount: inspection.receipts.length,
      receiptHead: head.receiptHash,
      evidenceHash,
      scoreHash: computedScoreHash,
    }
    const checkpoint: RunCheckpoint = {
      schemaVersion: 1,
      runId: seal.runId,
      receiptCount: seal.receiptCount,
      receiptHead: seal.receiptHead,
      evidenceHash,
      scoreHash: computedScoreHash,
      sealHash: hashCanonical('host-evidence-seal-v1', seal),
    }
    try {
      publishExclusive(handle.root, 'evidence.json', evidence)
      publishExclusive(handle.root, 'score.json', score)
      publishExclusive(handle.root, 'seal.json', seal)
      verifySealedRun(handle.root, checkpoint)
      state.sealed = true
    } catch (error) {
      state.poisoned = true
      throw new Error('integrity: seal persistence or verification failed; handle poisoned', {
        cause: error,
      })
    }
    return { checkpoint, evidence, score }
  })
}

function parseSeal(value: unknown): RunSeal {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('seal: expected object')
  const input = value as Record<string, unknown>
  const expected = [
    'bindingsHash',
    'descriptorHash',
    'evidenceHash',
    'manifestHash',
    'receiptCount',
    'receiptHead',
    'runId',
    'schemaVersion',
    'scoreHash',
  ].sort()
  const actual = Object.keys(input).sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new TypeError('seal: unexpected keys')
  if (
    input.schemaVersion !== 1 ||
    typeof input.runId !== 'string' ||
    typeof input.receiptCount !== 'number'
  )
    throw new TypeError('seal: invalid fields')
  for (const key of [
    'bindingsHash',
    'descriptorHash',
    'evidenceHash',
    'manifestHash',
    'receiptHead',
    'scoreHash',
  ] as const) {
    if (typeof input[key] !== 'string' || !/^[a-f0-9]{64}$/.test(input[key]))
      throw new TypeError(`seal: invalid ${key}`)
  }
  if (!Number.isSafeInteger(input.receiptCount) || input.receiptCount < 1)
    throw new TypeError('seal: invalid receipt count')
  return input as RunSeal
}

export function verifySealedRun(
  root: string,
  expectedCheckpoint?: RunCheckpoint,
): { checkpoint: RunCheckpoint; evidence: HostEvidence; score: HostEvidenceScore } {
  const inspection = inspectRoot(root)
  if (!inspection.sealed) throw new Error('seal: sealed artifacts missing')
  const derived = deriveHostEvidence(replayRun(inspection.context, inspection.receipts))
  if (derived.status !== 'ready')
    throw new Error(`completion: cannot derive sealed evidence: ${derived.status}`)
  const evidence = parseHostEvidence(
    readCanonical(
      path.join(root, 'evidence.json'),
      inspection.descriptor.uid,
      inspection.descriptor.gid,
      'evidence.json',
    ).value,
    inspection.manifest,
  )
  if (stableJson(evidence) !== stableJson(derived.evidence))
    throw new Error('integrity: stored evidence differs from receipt derivation')
  const computedScore = scoreHostEvidence(
    inspection.manifest,
    derived.evidence,
    inspection.bindings,
  )
  const storedScore = readCanonical(
    path.join(root, 'score.json'),
    inspection.descriptor.uid,
    inspection.descriptor.gid,
    'score.json',
  ).value
  if (stableJson(storedScore) !== stableJson(computedScore))
    throw new Error('integrity: stored score differs from rescoring')
  const seal = parseSeal(
    readCanonical(
      path.join(root, 'seal.json'),
      inspection.descriptor.uid,
      inspection.descriptor.gid,
      'seal.json',
    ).value,
  )
  const head = inspection.receipts.at(-1)
  const expectedSeal: RunSeal = {
    schemaVersion: 1,
    runId: inspection.descriptor.runId,
    descriptorHash: inspection.context.descriptorHash,
    manifestHash: inspection.context.manifestHash,
    bindingsHash: inspection.context.bindingsHash,
    receiptCount: inspection.receipts.length,
    receiptHead: head?.receiptHash ?? '',
    evidenceHash: hashCanonical('host-evidence-evidence-v1', derived.evidence),
    scoreHash: scoreHash(computedScore),
  }
  if (stableJson(seal) !== stableJson(expectedSeal))
    throw new Error('integrity: seal binding mismatch')
  const checkpoint: RunCheckpoint = {
    schemaVersion: 1,
    runId: seal.runId,
    receiptCount: seal.receiptCount,
    receiptHead: seal.receiptHead,
    evidenceHash: seal.evidenceHash,
    scoreHash: seal.scoreHash,
    sealHash: hashCanonical('host-evidence-seal-v1', seal),
  }
  if (expectedCheckpoint && stableJson(expectedCheckpoint) !== stableJson(checkpoint))
    throw new Error('integrity: expected checkpoint substitution detected')
  return { checkpoint, evidence: derived.evidence, score: computedScore }
}

export function disposeRun(handle: RunHandle): void {
  mutation(handle, (state) => {
    requireActive(handle, true, true)
    fs.rmSync(handle.root, { recursive: true })
    state.disposed = true
  })
}

export function receiptFileName(sequence: number): string {
  return receiptName(sequence)
}

export function verifyReceiptHash(receipt: Receipt): boolean {
  const { receiptHash, ...unsigned } = receipt
  return computeReceiptHash(unsigned) === receiptHash
}
