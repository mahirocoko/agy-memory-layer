import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  type FrozenContractBindings,
  type HostEvidence,
  type HostEvidenceManifest,
  type HostEvidenceScore,
  type StrictFinalResponse,
  sha256Text,
  stableJson,
} from './host-evidence-contract.ts'
import { hashCanonical, type ReceiptPayload } from './host-evidence-receipts.ts'
import {
  authorizeRun,
  createRun,
  dispatch,
  type RunCheckpoint,
  sealRun,
} from './host-evidence-store.ts'

export const DIRECT_CLI_JOB_SCHEMA = 'direct-cli.herdr-job.v2'
export const DIRECT_CLI_FIXTURE_SCHEMA = 'direct-cli.herdr-job.fixture.v1'
export const DIRECT_CLI_MESSAGE_SCHEMA = 'direct-cli.callback-message.v1'
export const CANARY_REPORT_SCHEMA_VERSION = 1
export const PHASE3_CHECKPOINT_SCHEMA_VERSION = 1
export const MAX_MESSAGE_BODY_BYTES = 8 * 1024
export const JOB_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/
export const TARGET_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/
export const MESSAGE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/
export const SHA256_PATTERN = /^[a-f0-9]{64}$/

// biome-ignore format: compact receipt type
export type DirectCliTargetReceipt = {
  role: 'target'
  paneId: string; workspaceId: string; tabId: string; terminal: string
  herdrSocket: string; cwd: string; agentKind: string; agentName: string; agentSession: string
  requestedPaneId?: string; herdrSession?: string; agentStatus?: string
  stateChangeSeq?: number; lettaTokens?: Record<string, unknown>
}

// biome-ignore format: compact parent receipt type
export type DirectCliParentReceipt = {
  role: 'parent'
  paneId: string; workspaceId: string; tabId: string; terminal: string
  herdrSocket: string; cwd: string
  requestedPaneId?: string; herdrSession?: string; agentKind?: string
  agentName?: string; agentSession?: string; lettaTokens?: Record<string, unknown>
}

export type DirectCliCurrentReceipt = {
  role: 'current'
  paneId: string
  workspaceId: string
  tabId: string
  terminal: string
  herdrSocket: string
  cwd: string
  requestedPaneId?: string
  herdrSession?: string | null
  agentKind?: string
  agentName?: string | null
  agentSession?: string | null
  lettaTokens?: Record<string, unknown>
}

export type DirectCliTargetRecord = {
  name: string
  baselineSeq?: number
  initialStatus?: string
  resultPath: string
  receipt: DirectCliTargetReceipt
}

export type DirectCliReportState = {
  status: 'report_ready' | 'report_failed' | 'pending'
  message?: string
  resultPath?: string
  bodySha256?: string
  reportedAt?: string
}

// biome-ignore format: compact job type
export type DirectCliJobV2 = {
  schema: typeof DIRECT_CLI_JOB_SCHEMA | typeof DIRECT_CLI_FIXTURE_SCHEMA
  id: string
  mode: 'callback' | 'watcher'
  status: 'done' | 'attention' | 'error' | 'running' | 'watching' | 'dispatching'
  cwd: string; tabId?: string
  promptSha256: string; taskSha256: string; taskPromptSha256: string
  dispatchSha256: string; dispatchPromptSha256: string
  targets: readonly DirectCliTargetRecord[]
  parentReceipt: DirectCliParentReceipt
  reports: Record<string, DirectCliReportState>
  messageCount: number
  watcherFallback?: boolean; summary?: string; collectedAt?: string; finishedAt?: string
  options?: Record<string, unknown>
}

// biome-ignore format: compact message type
export type DirectCliCallbackMessageV1 = {
  schema: typeof DIRECT_CLI_MESSAGE_SCHEMA
  job: string; id: string; from: string; to: string
  kind: 'report_ready' | 'report_failed' | 'progress' | 'question' | 'blocked' | 'reply'
  idempotencyKey: string; bodyPath: string; bodySha256: string; bodyBytes: number
  senderReceipt: DirectCliCurrentReceipt; createdAt: string
  delivery: { status: 'accepted' | 'failed' | 'pending'; updatedAt?: string; acceptedAt?: string; failedAt?: string }
  ack: { at: string; by: string; receipt: DirectCliCurrentReceipt } | null
}

export type DirectCliCanaryReport = {
  schemaVersion: typeof CANARY_REPORT_SCHEMA_VERSION
  taskId: string
  promptHash: string
  reportedHost: { agyVersion: string; model: string; effort: string }
  finalResponse: StrictFinalResponse
  invarianceClaims: { repositoryMutated: false; memfsMutated: false }
  providerAccounting: { providerRequests: 'unavailable'; providerInputBytes: 'unavailable' }
}

export type RepositorySnapshot = { headCommit: string; statusHash: string; contentHash: string }
export type MemfsSnapshot = { headCommit: string; statusHash: string; contentHash: string }

// biome-ignore format: compact checkpoint type
export type Phase3DirectCliCheckpoint = {
  schemaVersion: typeof PHASE3_CHECKPOINT_SCHEMA_VERSION
  phase: 'phase3-direct-cli'
  mode: 'live' | 'fixture'
  verifiedLive: boolean
  jobId: string
  directCliJobHash: string; reportHash: string
  targetReceipt: DirectCliTargetReceipt; parentReceipt: DirectCliParentReceipt
  beforeRepositorySnapshotHash: string; afterRepositorySnapshotHash: string
  beforeMemfsSnapshotHash: string; afterMemfsSnapshotHash: string
  phase2ReceiptCount: number; phase2ReceiptHead: string
  phase2Projection: 'compatibility-only'
  phase2Checkpoint: RunCheckpoint; checkpointHash: string
}

export type IngestDirectCliEvidenceParams = {
  jobDir: string
  manifest: HostEvidenceManifest
  bindings: FrozenContractBindings
  expectedCwd: string
  beforeRepositorySnapshot: RepositorySnapshot
  afterRepositorySnapshot: RepositorySnapshot
  beforeMemfsSnapshot: MemfsSnapshot
  afterMemfsSnapshot: MemfsSnapshot
  seenJobIds?: Set<string>
}

export type IngestDirectCliEvidenceResult = {
  phase3Checkpoint: Phase3DirectCliCheckpoint
  phase2Root: string
  evidence: HostEvidence
  score: HostEvidenceScore
  report: DirectCliCanaryReport
}

// biome-ignore format: compact exactKeys
function exactKeys(obj: Record<string, unknown>, expected: readonly string[], pathStr: string): void {
  const actual = Object.keys(obj).sort()
  const exp = [...expected].sort()
  if (actual.length !== exp.length || actual.some((k, i) => k !== exp[i])) {
    throw new TypeError(`${pathStr}: expected exact keys ${exp.join(', ')}`)
  }
}

function assertNotSymlink(targetPath: string, label: string): fs.Stats {
  const stat = fs.lstatSync(targetPath)
  if (stat.isSymbolicLink()) {
    throw new Error(`filesystem boundary: ${label} must not be a symlink: ${targetPath}`)
  }
  return stat
}

function assertDirectoryNoSymlinks(dirPath: string): void {
  const stat = assertNotSymlink(dirPath, 'directory')
  if (!stat.isDirectory()) throw new Error(`filesystem boundary: expected directory: ${dirPath}`)
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`filesystem boundary: symlinks forbidden in direct-cli bundle: ${full}`)
    }
    if (entry.isDirectory()) assertDirectoryNoSymlinks(full)
  }
}

function sha256Bytes(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

export function parseStrictFinalResponse(
  value: unknown,
  expectedFieldNames: readonly string[],
  prefix = 'report.finalResponse',
): StrictFinalResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${prefix}: expected object`)
  }
  const input = value as Record<string, unknown>
  exactKeys(input, ['answer', 'sources', 'status', 'taskId'], prefix)
  if (typeof input.taskId !== 'string' || input.taskId.length === 0) {
    throw new TypeError(`${prefix}.taskId: expected non-empty string`)
  }
  if (input.status !== 'ANSWERED' && input.status !== 'UNKNOWN') {
    throw new TypeError(`${prefix}.status: expected ANSWERED or UNKNOWN`)
  }
  if (typeof input.answer !== 'object' || input.answer === null || Array.isArray(input.answer)) {
    throw new TypeError(`${prefix}.answer: expected object`)
  }
  const answer = input.answer as Record<string, unknown>
  exactKeys(answer, expectedFieldNames, `${prefix}.answer`)
  const parsedAnswer: Record<string, string> = {}
  for (const field of expectedFieldNames) {
    if (typeof answer[field] !== 'string')
      throw new TypeError(`${prefix}.answer.${field}: expected string`)
    parsedAnswer[field] = answer[field] as string
  }
  if (!Array.isArray(input.sources)) throw new TypeError(`${prefix}.sources: expected array`)
  const sources: string[] = []
  for (let i = 0; i < input.sources.length; i += 1) {
    if (typeof input.sources[i] !== 'string' || input.sources[i].length === 0) {
      throw new TypeError(`${prefix}.sources[${i}]: expected non-empty string`)
    }
    sources.push(input.sources[i] as string)
  }
  return {
    taskId: input.taskId as string,
    status: input.status as 'ANSWERED' | 'UNKNOWN',
    answer: parsedAnswer,
    sources,
  }
}

export function parseDirectCliCanaryReport(
  rawText: string,
  manifest: HostEvidenceManifest,
): DirectCliCanaryReport {
  let text = rawText.trim()
  const CANARY_MARKER = '[direct-cli canary report]'
  if (text.startsWith(CANARY_MARKER)) text = text.slice(CANARY_MARKER.length).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new TypeError('report: malformed JSON', { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('report: expected object')
  }
  const input = parsed as Record<string, unknown>
  exactKeys(
    input,
    [
      'finalResponse',
      'invarianceClaims',
      'promptHash',
      'providerAccounting',
      'reportedHost',
      'schemaVersion',
      'taskId',
    ],
    'report',
  )
  if (input.schemaVersion !== CANARY_REPORT_SCHEMA_VERSION) {
    throw new TypeError(`report.schemaVersion: expected ${CANARY_REPORT_SCHEMA_VERSION}`)
  }
  if (input.taskId !== manifest.taskId)
    throw new TypeError(`report.taskId mismatch: expected ${manifest.taskId}`)
  if (input.promptHash !== manifest.promptHash)
    throw new TypeError(`report.promptHash mismatch: expected ${manifest.promptHash}`)
  if (
    typeof input.reportedHost !== 'object' ||
    input.reportedHost === null ||
    Array.isArray(input.reportedHost)
  ) {
    throw new TypeError('report.reportedHost: expected object')
  }
  const host = input.reportedHost as Record<string, unknown>
  exactKeys(host, ['agyVersion', 'effort', 'model'], 'report.reportedHost')
  if (
    host.agyVersion !== manifest.plannedHost.agyVersion ||
    host.model !== manifest.plannedHost.model ||
    host.effort !== manifest.plannedHost.effort
  ) {
    throw new TypeError('report.reportedHost: host claims drift from manifest plannedHost')
  }
  if (
    typeof input.invarianceClaims !== 'object' ||
    input.invarianceClaims === null ||
    Array.isArray(input.invarianceClaims)
  ) {
    throw new TypeError('report.invarianceClaims: expected object')
  }
  const inv = input.invarianceClaims as Record<string, unknown>
  exactKeys(inv, ['memfsMutated', 'repositoryMutated'], 'report.invarianceClaims')
  if (inv.repositoryMutated !== false || inv.memfsMutated !== false) {
    throw new TypeError('report.invarianceClaims: repo or memfs mutation claimed')
  }
  if (
    typeof input.providerAccounting !== 'object' ||
    input.providerAccounting === null ||
    Array.isArray(input.providerAccounting)
  ) {
    throw new TypeError('report.providerAccounting: expected object')
  }
  const prov = input.providerAccounting as Record<string, unknown>
  exactKeys(prov, ['providerInputBytes', 'providerRequests'], 'report.providerAccounting')
  if (prov.providerRequests !== 'unavailable' || prov.providerInputBytes !== 'unavailable') {
    throw new TypeError('report.providerAccounting: claims must be unavailable')
  }
  const expectedFieldNames = manifest.expectedResponse.fields.map((f) => f.name)
  const finalResponse = parseStrictFinalResponse(
    input.finalResponse,
    expectedFieldNames,
    'report.finalResponse',
  )
  return {
    schemaVersion: CANARY_REPORT_SCHEMA_VERSION,
    taskId: input.taskId as string,
    promptHash: input.promptHash as string,
    reportedHost: {
      agyVersion: host.agyVersion as string,
      model: host.model as string,
      effort: host.effort as string,
    },
    finalResponse,
    invarianceClaims: { repositoryMutated: false, memfsMutated: false },
    providerAccounting: { providerRequests: 'unavailable', providerInputBytes: 'unavailable' },
  }
}

function captureGitSnapshot(repoDir: string): RepositorySnapshot {
  const headCommit = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  const statusOut = execFileSync('git', ['-C', repoDir, 'status', '--porcelain=v1', '-z'], {
    encoding: 'buffer',
  })
  const listed = execFileSync(
    'git',
    ['-C', repoDir, 'ls-files', '-co', '--exclude-standard', '-z'],
    { encoding: 'buffer' },
  )
  const content = createHash('sha256')
  for (const relative of listed.toString('utf8').split('\0').filter(Boolean).sort()) {
    if (path.isAbsolute(relative) || relative.split(path.sep).includes('..')) {
      throw new Error('invariance: unsafe Git path')
    }
    const file = path.join(repoDir, relative)
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`invariance: Git entry must be a regular file: ${relative}`)
    }
    content
      .update(relative)
      .update('\0')
      .update(String(stat.mode & 0o777))
      .update('\0')
      .update(fs.readFileSync(file))
      .update('\0')
  }
  return {
    headCommit,
    statusHash: sha256Bytes(statusOut),
    contentHash: content.digest('hex'),
  }
}

export function captureRepositorySnapshot(repoDir: string): RepositorySnapshot {
  return captureGitSnapshot(fs.realpathSync(repoDir))
}

export function captureMemfsSnapshot(memfsDir: string): MemfsSnapshot {
  return captureGitSnapshot(fs.realpathSync(memfsDir))
}

export function savePhase3Checkpoint(
  checkpoint: Phase3DirectCliCheckpoint,
  targetPath: string,
): void {
  const dir = path.dirname(targetPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700, recursive: true })
  fs.writeFileSync(targetPath, JSON.stringify(checkpoint, null, 2), { mode: 0o600 })
}

export function loadPhase3Checkpoint(sourcePath: string): Phase3DirectCliCheckpoint {
  assertNotSymlink(sourcePath, 'checkpoint')
  const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as Phase3DirectCliCheckpoint
  if (!verifyPhase3Checkpoint(parsed))
    throw new Error('checkpoint: integrity or verification check failed')
  return parsed
}

export function verifyPhase3Checkpoint(
  checkpoint: Phase3DirectCliCheckpoint,
  expectedMode?: 'live' | 'fixture',
): boolean {
  if (
    checkpoint.schemaVersion !== PHASE3_CHECKPOINT_SCHEMA_VERSION ||
    checkpoint.phase !== 'phase3-direct-cli'
  ) {
    return false
  }
  if (expectedMode && checkpoint.mode !== expectedMode) return false
  if (checkpoint.mode === 'fixture' && checkpoint.verifiedLive) return false
  if (checkpoint.mode === 'live' && !checkpoint.verifiedLive) return false
  if (checkpoint.beforeRepositorySnapshotHash !== checkpoint.afterRepositorySnapshotHash)
    return false
  if (checkpoint.beforeMemfsSnapshotHash !== checkpoint.afterMemfsSnapshotHash) return false
  if (checkpoint.phase2Projection !== 'compatibility-only') return false
  // biome-ignore format: compact unsigned checkpoint
  const unsigned = {
    schemaVersion: checkpoint.schemaVersion, phase: checkpoint.phase, mode: checkpoint.mode, verifiedLive: checkpoint.verifiedLive,
    jobId: checkpoint.jobId, directCliJobHash: checkpoint.directCliJobHash, reportHash: checkpoint.reportHash,
    targetReceipt: checkpoint.targetReceipt, parentReceipt: checkpoint.parentReceipt,
    beforeRepositorySnapshotHash: checkpoint.beforeRepositorySnapshotHash, afterRepositorySnapshotHash: checkpoint.afterRepositorySnapshotHash,
    beforeMemfsSnapshotHash: checkpoint.beforeMemfsSnapshotHash, afterMemfsSnapshotHash: checkpoint.afterMemfsSnapshotHash,
    phase2ReceiptCount: checkpoint.phase2ReceiptCount, phase2ReceiptHead: checkpoint.phase2ReceiptHead,
    phase2Projection: checkpoint.phase2Projection, phase2Checkpoint: checkpoint.phase2Checkpoint,
  }
  const expectedHash = hashCanonical('phase3-direct-cli-checkpoint-v1', unsigned)
  return checkpoint.checkpointHash === expectedHash
}

export function createCanaryReportBody(params: {
  taskId: string
  promptHash: string
  agyVersion: string
  model: string
  effort: string
  finalResponse: StrictFinalResponse
}): string {
  const report: DirectCliCanaryReport = {
    schemaVersion: CANARY_REPORT_SCHEMA_VERSION,
    taskId: params.taskId,
    promptHash: params.promptHash,
    reportedHost: { agyVersion: params.agyVersion, model: params.model, effort: params.effort },
    finalResponse: params.finalResponse,
    invarianceClaims: { repositoryMutated: false, memfsMutated: false },
    providerAccounting: { providerRequests: 'unavailable', providerInputBytes: 'unavailable' },
  }
  return `[direct-cli canary report]\n${JSON.stringify(report, null, 2)}`
}

function receiptsMatch(
  expected: DirectCliTargetReceipt | DirectCliParentReceipt,
  actual: DirectCliCurrentReceipt,
): boolean {
  if (
    actual.role !== 'current' ||
    expected.paneId !== actual.paneId ||
    expected.workspaceId !== actual.workspaceId ||
    expected.tabId !== actual.tabId
  )
    return false
  if (
    expected.terminal !== actual.terminal ||
    expected.herdrSocket !== actual.herdrSocket ||
    expected.cwd !== actual.cwd
  )
    return false
  if (expected.herdrSession && expected.herdrSession !== actual.herdrSession) return false
  if (expected.role === 'target') {
    return (
      actual.agentKind === expected.agentKind &&
      typeof actual.agentSession === 'string' &&
      actual.agentSession === expected.agentSession
    )
  }
  return stableJson(expected.lettaTokens ?? {}) === stableJson(actual.lettaTokens ?? {})
}

export function ingestAndVerifyDirectCliEvidence(
  params: IngestDirectCliEvidenceParams,
): IngestDirectCliEvidenceResult {
  const jobDir = path.resolve(params.jobDir)
  assertDirectoryNoSymlinks(jobDir)

  if (
    sha256Text(stableJson(params.beforeRepositorySnapshot)) !==
    sha256Text(stableJson(params.afterRepositorySnapshot))
  ) {
    throw new Error('invariance: repository snapshot modified during run')
  }
  if (
    sha256Text(stableJson(params.beforeMemfsSnapshot)) !==
    sha256Text(stableJson(params.afterMemfsSnapshot))
  ) {
    throw new Error('invariance: MemFS snapshot modified during run')
  }

  const jobJsonPath = path.join(jobDir, 'job.json')
  assertNotSymlink(jobJsonPath, 'job.json')
  let job: DirectCliJobV2
  try {
    job = JSON.parse(fs.readFileSync(jobJsonPath, 'utf8')) as DirectCliJobV2
  } catch (error) {
    throw new Error('representation: job.json malformed JSON', { cause: error })
  }

  if (job.schema !== DIRECT_CLI_JOB_SCHEMA && job.schema !== DIRECT_CLI_FIXTURE_SCHEMA)
    throw new Error(`schema: unsupported job schema: ${String(job.schema)}`)
  if (job.mode !== 'callback')
    throw new Error(`mode: expected callback mode, found ${String(job.mode)}`)
  if (job.status !== 'done')
    throw new Error(`status: expected terminal done status, found ${String(job.status)}`)
  if (!JOB_ID_PATTERN.test(job.id)) throw new Error(`jobId: invalid job id format: ${job.id}`)
  if (path.basename(jobDir) !== job.id)
    throw new Error('jobId: directory name does not match job.id')
  if (job.watcherFallback === true)
    throw new Error('mode: watcher fallback cannot serve as live callback proof')

  if (params.seenJobIds) {
    if (params.seenJobIds.has(job.id))
      throw new Error(`ownership: duplicate/reused job identity detected: ${job.id}`)
    params.seenJobIds.add(job.id)
  }

  const resolvedExpectedCwd = fs.realpathSync(path.resolve(params.expectedCwd))
  let resolvedJobCwd: string
  try {
    resolvedJobCwd = fs.realpathSync(path.resolve(job.cwd))
  } catch {
    resolvedJobCwd = path.resolve(job.cwd)
  }
  if (resolvedJobCwd !== resolvedExpectedCwd) {
    throw new Error(
      `cwd: job working directory mismatch: expected ${resolvedExpectedCwd}, found ${resolvedJobCwd}`,
    )
  }

  if (
    job.promptSha256 !== job.taskSha256 ||
    job.taskSha256 !== job.taskPromptSha256 ||
    !SHA256_PATTERN.test(job.promptSha256)
  ) {
    throw new Error('binding: task prompt SHA-256 values inconsistent')
  }
  if (job.dispatchSha256 !== job.dispatchPromptSha256 || !SHA256_PATTERN.test(job.dispatchSha256)) {
    throw new Error('binding: dispatch prompt SHA-256 values inconsistent')
  }
  if (job.promptSha256 !== params.manifest.promptHash) {
    throw new Error(
      `binding: prompt hash mismatch with manifest: expected ${params.manifest.promptHash}, found ${job.promptSha256}`,
    )
  }
  if (params.manifest.promptHash !== params.bindings.promptHash) {
    throw new Error('binding: manifest and bindings prompt hash mismatch')
  }

  const promptTxtBytes = fs.readFileSync(path.join(jobDir, 'prompt.txt'))
  if (promptTxtBytes.includes(0)) throw new Error('representation: prompt.txt contains NUL bytes')
  if (sha256Bytes(promptTxtBytes) !== job.promptSha256)
    throw new Error('binding: prompt.txt SHA-256 does not match job.promptSha256')

  const dispatchPromptTxtBytes = fs.readFileSync(path.join(jobDir, 'dispatch-prompt.txt'))
  if (dispatchPromptTxtBytes.includes(0))
    throw new Error('representation: dispatch-prompt.txt contains NUL bytes')
  if (sha256Bytes(dispatchPromptTxtBytes) !== job.dispatchSha256) {
    throw new Error('binding: dispatch-prompt.txt SHA-256 does not match job.dispatchSha256')
  }
  const callbackPrefix = Buffer.concat([
    promptTxtBytes,
    Buffer.from('\n\n[Direct-CLI callback contract]\n', 'utf8'),
  ])
  if (!dispatchPromptTxtBytes.subarray(0, callbackPrefix.length).equals(callbackPrefix)) {
    throw new Error(
      'binding: dispatch prompt is not the task prompt plus Direct CLI callback footer',
    )
  }

  if (!Array.isArray(job.targets) || job.targets.length !== 1) {
    throw new Error(`target: expected exactly one target, found ${job.targets?.length ?? 0}`)
  }
  const targetRecord = job.targets[0]
  if (!TARGET_NAME_PATTERN.test(targetRecord.name))
    throw new Error(`target: invalid target name: ${targetRecord.name}`)
  if (targetRecord.resultPath !== `results/${targetRecord.name}.txt`)
    throw new Error('target: resultPath escaped expected convention')
  const targetReceipt = targetRecord.receipt
  if (targetReceipt.role !== 'target') throw new Error('target: receipt role must be target')
  for (const field of [
    'paneId',
    'workspaceId',
    'tabId',
    'terminal',
    'herdrSocket',
    'agentSession',
  ] as const) {
    if (typeof targetReceipt[field] !== 'string' || targetReceipt[field].trim().length === 0) {
      throw new Error(`target: receipt missing non-empty ${field}`)
    }
  }
  if (typeof targetReceipt.agentKind !== 'string' || !targetReceipt.agentKind.startsWith('agy')) {
    throw new Error(`target: agentKind must be agy, found ${String(targetReceipt.agentKind)}`)
  }
  if (targetReceipt.agentName !== targetRecord.name)
    throw new Error('target: agentName does not match target.name')
  let resolvedTargetCwd: string
  try {
    resolvedTargetCwd = fs.realpathSync(path.resolve(targetReceipt.cwd))
  } catch {
    resolvedTargetCwd = path.resolve(targetReceipt.cwd)
  }
  if (resolvedTargetCwd !== resolvedExpectedCwd) throw new Error('target: receipt cwd mismatch')

  const parentReceipt = job.parentReceipt
  if (parentReceipt?.role !== 'parent') throw new Error('parent: receipt role must be parent')
  for (const field of ['paneId', 'workspaceId', 'tabId', 'terminal', 'herdrSocket'] as const) {
    if (typeof parentReceipt[field] !== 'string' || parentReceipt[field].trim().length === 0) {
      throw new Error(`parent: receipt missing non-empty ${field}`)
    }
  }

  const reports = job.reports
  if (!reports || typeof reports !== 'object') throw new Error('reports: job.reports missing')
  const reportState = reports[targetRecord.name]
  if (!reportState) throw new Error(`reports: missing report for target ${targetRecord.name}`)
  if (reportState.status !== 'report_ready') {
    throw new Error(`reports: target report status is ${reportState.status}, expected report_ready`)
  }
  const messageId = reportState.message
  if (!messageId || !MESSAGE_ID_PATTERN.test(messageId))
    throw new Error('reports: invalid or missing report message ID')
  if (!reportState.bodySha256 || !SHA256_PATTERN.test(reportState.bodySha256))
    throw new Error('reports: invalid report bodySha256')

  const messageDir = path.join(jobDir, 'messages', messageId)
  assertNotSymlink(messageDir, 'message directory')
  const messageJsonPath = path.join(messageDir, 'message.json')
  assertNotSymlink(messageJsonPath, 'message.json')
  let message: DirectCliCallbackMessageV1
  try {
    message = JSON.parse(fs.readFileSync(messageJsonPath, 'utf8')) as DirectCliCallbackMessageV1
  } catch (error) {
    throw new Error('representation: message.json malformed JSON', { cause: error })
  }

  if (message.schema !== DIRECT_CLI_MESSAGE_SCHEMA)
    throw new Error(`schema: unsupported message schema: ${String(message.schema)}`)
  if (message.job !== job.id) throw new Error('message: job ID mismatch')
  if (message.id !== messageId) throw new Error('message: message ID mismatch')
  if (message.from !== targetRecord.name)
    throw new Error('message: sender does not match target name')
  if (message.to !== 'parent') throw new Error('message: recipient must be parent')
  if (message.kind !== 'report_ready')
    throw new Error(`message: kind is ${message.kind}, expected report_ready`)
  if (message.bodyPath !== `messages/${messageId}/body`)
    throw new Error('message: bodyPath escaped expected convention')
  if (message.bodySha256 !== reportState.bodySha256)
    throw new Error('message: bodySha256 mismatch with job reportState')
  if (
    !Number.isSafeInteger(message.bodyBytes) ||
    message.bodyBytes < 0 ||
    message.bodyBytes > MAX_MESSAGE_BODY_BYTES
  ) {
    throw new Error(`message: bodyBytes exceeds limit: ${message.bodyBytes}`)
  }
  if (!receiptsMatch(targetReceipt, message.senderReceipt))
    throw new Error('message: senderReceipt mismatch with target receipt')
  if (message.delivery?.status !== 'accepted')
    throw new Error(`message: delivery status is ${message.delivery?.status}, expected accepted`)
  if (message.ack?.by !== 'parent' || !message.ack.receipt)
    throw new Error('message: missing parent acknowledgement')
  if (!receiptsMatch(parentReceipt, message.ack.receipt))
    throw new Error('message: acknowledgement receipt mismatch with parent receipt')

  const bodyPath = path.join(messageDir, 'body')
  assertNotSymlink(bodyPath, 'message body')
  const bodyBytes = fs.readFileSync(bodyPath)
  if (bodyBytes.length !== message.bodyBytes)
    throw new Error('message: body size does not match declared bodyBytes')
  if (bodyBytes.length > MAX_MESSAGE_BODY_BYTES)
    throw new Error(`message: body size exceeds ${MAX_MESSAGE_BODY_BYTES} bytes`)
  if (bodyBytes.includes(0)) throw new Error('message: body contains NUL bytes')
  if (sha256Bytes(bodyBytes) !== message.bodySha256)
    throw new Error('message: body content SHA-256 mismatch')

  const resultPath = path.join(jobDir, targetRecord.resultPath)
  assertNotSymlink(resultPath, 'result file')
  const resultBytes = fs.readFileSync(resultPath)
  if (!resultBytes.equals(bodyBytes))
    throw new Error('result: results file content does not match finalized message body')

  const reportBodyText = bodyBytes.toString('utf8')
  const canaryReport = parseDirectCliCanaryReport(reportBodyText, params.manifest)

  const handle = createRun(params.manifest, { ownerId: 'direct-cli', trustRequired: false })
  authorizeRun(handle)

  const processId = targetReceipt.terminal
  // biome-ignore format: compact dispatches
  const dispatches: ReceiptPayload[] = [
    { event: 'attempt.reserved', attemptId: 'attempt-1', processId },
    { event: 'shell.ready', attemptId: 'attempt-1', shellProcessId: processId, foregroundProcessId: processId, foregroundProcessCount: 1, cwd: resolvedExpectedCwd },
    { event: 'host.observed', attemptId: 'attempt-1', agyVersion: params.manifest.plannedHost.agyVersion, model: params.manifest.plannedHost.model, effort: params.manifest.plannedHost.effort },
    { event: 'effect.reserved', attemptId: 'attempt-1', effectId: 'conv', operation: 'conversation-create' },
    { event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'conv' },
    { event: 'conversation.created', attemptId: 'attempt-1', effectId: 'conv', conversationId: targetReceipt.agentSession },
    { event: 'effect.reserved', attemptId: 'attempt-1', effectId: 'input', operation: 'user-input' },
    { event: 'effect.submitted', attemptId: 'attempt-1', effectId: 'input' },
    { event: 'user-input.observed', attemptId: 'attempt-1', effectId: 'input', conversationId: targetReceipt.agentSession, structured: true, taskId: params.manifest.taskId, promptHash: params.manifest.promptHash },
    { event: 'planner.response', attemptId: 'attempt-1', effectId: 'input', conversationId: targetReceipt.agentSession, kind: 'final', response: canaryReport.finalResponse },
    { event: 'observations.closed', captureTruncated: false, truncatedFields: [], providerRequestVisibility: 'incomplete' },
  ]
  for (const p of dispatches) dispatch(handle, p)

  const sealed = sealRun(handle)
  if (!sealed.score.passed) {
    throw new Error('score: verified Direct CLI evidence did not pass the frozen Phase 2 contract')
  }

  const directCliJobHash = sha256Text(stableJson(job))
  const reportHash = sha256Text(reportBodyText)
  const beforeRepositorySnapshotHash = sha256Text(stableJson(params.beforeRepositorySnapshot))
  const afterRepositorySnapshotHash = sha256Text(stableJson(params.afterRepositorySnapshot))
  const beforeMemfsSnapshotHash = sha256Text(stableJson(params.beforeMemfsSnapshot))
  const afterMemfsSnapshotHash = sha256Text(stableJson(params.afterMemfsSnapshot))
  const mode: 'live' | 'fixture' = job.schema === DIRECT_CLI_JOB_SCHEMA ? 'live' : 'fixture'
  const verifiedLive = mode === 'live'

  // biome-ignore format: compact unsigned checkpoint
  const unsignedCheckpoint = {
    schemaVersion: 1 as const, phase: 'phase3-direct-cli' as const, mode, verifiedLive, jobId: job.id,
    directCliJobHash, reportHash, targetReceipt, parentReceipt, beforeRepositorySnapshotHash, afterRepositorySnapshotHash,
    beforeMemfsSnapshotHash, afterMemfsSnapshotHash, phase2ReceiptCount: sealed.checkpoint.receiptCount,
    phase2ReceiptHead: sealed.checkpoint.receiptHead, phase2Projection: 'compatibility-only' as const,
    phase2Checkpoint: sealed.checkpoint,
  }
  const checkpointHash = hashCanonical('phase3-direct-cli-checkpoint-v1', unsignedCheckpoint)
  const phase3Checkpoint: Phase3DirectCliCheckpoint = { ...unsignedCheckpoint, checkpointHash }

  return {
    phase3Checkpoint,
    phase2Root: handle.root,
    evidence: sealed.evidence,
    score: sealed.score,
    report: canaryReport,
  }
}
