#!/usr/bin/env node

/**
 * Auto-Dream Background Daemon for agy-memory-layer
 * Scans historical and recent conversations in ~/.gemini/antigravity-cli/brain/
 * Synthesizes explicit durable corrections into recall-only project archives.
 * Inspired by Letta Code sleep-time reflection architecture & Step-Count triggers (DEFAULT_STEP_COUNT = 20)
 *
 * Regex Dream stays the default. `--llm` selects one unreflected slice and
 * creates explicit proposals only. It does not update lastDreamedSteps.
 * Persisted reflection stays disabled by default. Invalid reflection config is
 * refused. LLM cron source can preview a line and install only with an explicit
 * confirmation while reflection.enabled is true. No LLM schedule is installed
 * by tests or by this module's import. A provider attempt uses a private temp
 * directory and a separate reservation. The shared writer lock is not held
 * during the provider call. Cursor and failure updates reread Dream state
 * inside that lock and patch only the owned reflection fields.
 */

import { execFileSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  acquireReflectionReservation,
  inspectReflectionReservation,
  type ReflectionReservation,
  type ReflectionReservationAcquire,
  reclaimDeadReflectionReservation,
  releaseReflectionReservation,
} from './dream-reflection-reservation.ts'
import {
  type CronExecutor,
  installLlmReflectionCron,
  installRegexDreamCron,
  previewLlmReflectionCron,
  uninstallRegexDreamCron,
} from './dream-reflection-schedule.ts'
import {
  AGY_HOST_ISOLATION,
  AGY_REFLECTION_CHILD_ENV,
  createAgyReflectionTransport,
  createReflectionRunDirectory,
  type ReflectionTransport,
  ReflectionTransportError,
  reflectionResponseJsonSchema,
} from './dream-reflection-transport.ts'
import {
  boundTextByCodePoints,
  buildReflectionPrompt,
  type CommittedMemorySnapshot,
  DELETE_CLASSIFICATION,
  parseReflectionResponse,
  planReflectionOperations,
  ReflectionRejectedError,
  type ReflectionRejectionCode,
} from './dream-reflector.ts'
import { inspectCommittedMemoryProjection } from './layered-memory.ts'
import {
  createExplicitProposalSet,
  discardExplicitProposals,
  listPendingProposals,
  MemoryProposalSetError,
} from './memory-approval.ts'
import { middleTruncateText } from './memory-compactor.ts'
import {
  assertMemoryRepositoryCleanForWrite,
  commitMemoryPaths,
  getMemoryHeadRevision,
  readCommittedMemoryFile,
  restoreDeclaredMemoryPaths,
  validateProjectSlug,
  writeMemoryFile,
} from './memory-repository.ts'
import {
  acquireMemoryWriteLock,
  MemoryWriteLockError,
  memoryStateRootFor,
  releaseMemoryWriteLock,
} from './memory-write-lock.ts'
import {
  projectScopeExists,
  readConversationWorkspaceMap,
  resolveProjectSlug,
} from './workspace-identity.ts'

export const DEFAULT_REFLECTION_STEP_COUNT = 50
export const DEFAULT_REFLECTION_MODEL = 'claude-opus-4-6-thinking'
export const REFLECTION_MEMORY_BUDGET_CAP = 40_000
export const REFLECTION_TRANSCRIPT_BUDGET_CAP = 60_000
export const REFLECTION_MAX_STEP_COUNT = 10_000
export const REFLECTION_BASE_BACKOFF_MINUTES = 15
export const REFLECTION_MAX_BACKOFF_MINUTES = 360
export const REFLECTION_MAX_FAILURE_COUNT = 32
export const DREAM_REFLECTION_AUTHOR = 'Dream v2 reflection'

export type DreamReflectionFailure = {
  count: number
  lastAt: string
  code: string
}

export type DreamReflectionState = {
  enabled: boolean
  model: string
  fallbackModel: string | null
  maxOperations: number
  memoryCharacterBudget: number
  transcriptCharacterBudget: number
  stepCountThreshold: number
  baseBackoffMinutes: number
  maxBackoffMinutes: number
  reflectedThroughStep: Record<string, number>
  failures: Record<string, DreamReflectionFailure>
  lastRunByConversation: Record<string, string>
}

export type DreamState = {
  stateRevision: number
  lastRun: string | null
  stepCountThreshold: number
  lastDreamedSteps: Record<string, number>
  lastRunByProject: Record<string, string>
  reflection: DreamReflectionState
}

type DreamStateRead =
  | { kind: 'missing' }
  | { kind: 'valid'; state: DreamState }
  | {
      kind: 'reflection-invalid'
      state: DreamState
      error: string
      rawReflection: unknown
    }
  | { kind: 'revision-invalid'; error: string }
  | { kind: 'corrupt'; error: string }

export class DreamReflectionConfigError extends Error {
  readonly code = 'CONFIG_INVALID' as const

  constructor(message: string) {
    super(message)
    this.name = 'DreamReflectionConfigError'
  }
}

export class DreamStateConflictError extends Error {
  readonly code = 'STATE_CONFLICT' as const

  constructor(expectedRevision: number, currentRevision: number) {
    super(
      `Dream state changed after it was read (expected revision ${expectedRevision}, current revision ${currentRevision}). Reload before saving.`,
    )
    this.name = 'DreamStateConflictError'
  }
}

export class DreamStateRevisionError extends Error {
  readonly code = 'STATE_REVISION_INVALID' as const

  constructor(message = 'Dream stateRevision must be a non-negative safe integer.') {
    super(message)
    this.name = 'DreamStateRevisionError'
  }
}

export type DreamReflectionConversationStatus = {
  conversationId: string
  projectSlug: string
  cursor: number
  steps: number
  lag: number
  consecutiveFailures: number
  latestFailureCode: string | null
  latestFailureAt: string | null
  nextEligibleAt: string | null
}

export type DreamReflectionStatusReport = {
  config: 'valid' | 'invalid'
  configError: string | null
  enabled: boolean | null
  model: string | null
  fallbackModel: string | null
  stepCountThreshold: number | null
  baseBackoffMinutes: number | null
  maxBackoffMinutes: number | null
  maxOperations: number | null
  memoryCharacterBudget: number | null
  transcriptCharacterBudget: number | null
  schedule: 'not-inspected'
  eligibleConversationCount: number
  pendingProposalCount: number
  conversations: DreamReflectionConversationStatus[]
}

export type PendingConversation = {
  id: string
  shortId: string
  mtime: Date
  ageMinutes: number
  steps: number
  logPath: string
  workspacePath: string
  projectSlug: string
}

export type ScanOptions = {
  minSteps?: number
  idleMinutes?: number
  force?: boolean
  stepCount?: number
}

export type ProcessedDreamResult = {
  convId: string
  shortId: string
  status: 'written' | 'skipped' | 'already-dreamed'
  file?: string
}

export type ProjectDreamOutcome = {
  slug: string
  results: ProcessedDreamResult[]
  commitSha?: string
}

export type UninitializedDreamProject = {
  slug: string
  conversations: number
}

export type CrossProjectDreamReport = {
  projects: ProjectDreamOutcome[]
  uninitialized: UninitializedDreamProject[]
}

export type DreamCliScope =
  | { kind: 'current' }
  | { kind: 'all-projects' }
  | { kind: 'project'; slug: string }

type PendingScanContext = {
  minSteps: number
  idleMinutes: number
  force: boolean
  dreamedIds: Set<string>
  dreamState: DreamState
}

type PreparedDreamNote = {
  conv: PendingConversation
  doc: string | null
}

type PreparedProjectDream = {
  slug: string
  notes: PreparedDreamNote[]
}

export const DEFAULT_STEP_COUNT = 20
const memoryRoot =
  process.env.AGY_MEMORY_DIR || path.join(process.env.HOME || '', '.gemini', 'memory')
const brainDir = path.join(process.env.HOME || '', '.gemini', 'antigravity-cli', 'brain')
const memoryStateRoot = memoryStateRootFor(memoryRoot)
const stateFile = path.join(memoryStateRoot, 'dream-state.json')

export function getProjectSlug(workspaceDir: string = process.cwd()): string {
  return resolveProjectSlug(workspaceDir, memoryRoot)
}

export function isProjectMemoryInitialized(slug: string): boolean {
  return projectScopeExists(memoryRoot, validateProjectSlug(slug))
}

const createDefaultReflectionState = (): DreamReflectionState => ({
  enabled: false,
  model: DEFAULT_REFLECTION_MODEL,
  fallbackModel: null,
  maxOperations: 8,
  memoryCharacterBudget: REFLECTION_MEMORY_BUDGET_CAP,
  transcriptCharacterBudget: REFLECTION_TRANSCRIPT_BUDGET_CAP,
  stepCountThreshold: DEFAULT_REFLECTION_STEP_COUNT,
  baseBackoffMinutes: 15,
  maxBackoffMinutes: 360,
  reflectedThroughStep: {},
  failures: {},
  lastRunByConversation: {},
})

const createDefaultDreamState = (): DreamState => ({
  stateRevision: 0,
  lastRun: null,
  stepCountThreshold: DEFAULT_STEP_COUNT,
  lastDreamedSteps: {},
  lastRunByProject: {},
  reflection: createDefaultReflectionState(),
})

const REFLECTION_FIELDS = [
  'enabled',
  'model',
  'fallbackModel',
  'maxOperations',
  'memoryCharacterBudget',
  'transcriptCharacterBudget',
  'stepCountThreshold',
  'baseBackoffMinutes',
  'maxBackoffMinutes',
  'reflectedThroughStep',
  'failures',
  'lastRunByConversation',
] as const

const FAILURE_FIELDS = ['count', 'lastAt', 'code'] as const
const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function rejectReflectionConfig(message: string): never {
  throw new DreamReflectionConfigError(message)
}

const boundedFieldName = (key: string): string => {
  const chars = [...key]
  if (chars.length <= 64) return key
  return `${chars.slice(0, 64).join('')}...`
}

const assertKnownFields = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      rejectReflectionConfig(`Unknown ${label} field "${boundedFieldName(key)}".`)
    }
  }
}

const readExactInteger = (
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (!(key in source)) return fallback
  const value = source[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    rejectReflectionConfig(`reflection.${key} must be an integer from ${min} to ${max}.`)
  }
  return value
}

const assertConversationId = (id: string, label: string): void => {
  if (!CONVERSATION_ID_PATTERN.test(id)) {
    rejectReflectionConfig(`${label} contains an invalid conversation id.`)
  }
}

const assertUtcTimestamp = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) {
    rejectReflectionConfig(`${label} must be a UTC ISO-8601 timestamp.`)
  }
  if (new Date(value).toISOString() !== value) {
    rejectReflectionConfig(`${label} must be a UTC ISO-8601 timestamp.`)
  }
  return value
}

const normalizeCursorMap = (value: unknown, label: string): Record<string, number> => {
  if (value === undefined) return {}
  if (!isRecord(value)) rejectReflectionConfig(`${label} must be an object.`)
  const steps: Record<string, number> = {}
  for (const [id, step] of Object.entries(value)) {
    assertConversationId(id, label)
    if (typeof step !== 'number' || !Number.isInteger(step) || step < 0) {
      rejectReflectionConfig(`${label}.${id} must be an integer >= 0.`)
    }
    steps[id] = step
  }
  return steps
}

const normalizeFailureMap = (value: unknown): Record<string, DreamReflectionFailure> => {
  if (value === undefined) return {}
  if (!isRecord(value)) rejectReflectionConfig('reflection.failures must be an object.')
  const failures: Record<string, DreamReflectionFailure> = {}
  for (const [id, entry] of Object.entries(value)) {
    assertConversationId(id, 'reflection.failures')
    if (!isRecord(entry)) rejectReflectionConfig(`reflection.failures.${id} must be an object.`)
    assertKnownFields(entry, FAILURE_FIELDS, `reflection.failures.${id}`)
    if (
      typeof entry.count !== 'number' ||
      !Number.isInteger(entry.count) ||
      entry.count < 0 ||
      entry.count > REFLECTION_MAX_FAILURE_COUNT
    ) {
      rejectReflectionConfig(
        `reflection.failures.${id}.count must be an integer from 0 to ${REFLECTION_MAX_FAILURE_COUNT}.`,
      )
    }
    if (typeof entry.code !== 'string' || !FAILURE_CODE_PATTERN.test(entry.code)) {
      rejectReflectionConfig(`reflection.failures.${id}.code is not a bounded failure code.`)
    }
    failures[id] = {
      count: entry.count,
      lastAt: assertUtcTimestamp(entry.lastAt, `reflection.failures.${id}.lastAt`),
      code: entry.code,
    }
  }
  return failures
}

const normalizeTimestampMap = (value: unknown): Record<string, string> => {
  if (value === undefined) return {}
  if (!isRecord(value)) {
    rejectReflectionConfig('reflection.lastRunByConversation must be an object.')
  }
  const entries: Record<string, string> = {}
  for (const [id, entry] of Object.entries(value)) {
    assertConversationId(id, 'reflection.lastRunByConversation')
    entries[id] = assertUtcTimestamp(entry, `reflection.lastRunByConversation.${id}`)
  }
  return entries
}

const normalizeReflectionState = (value: unknown): DreamReflectionState => {
  const reflection = createDefaultReflectionState()
  if (!isRecord(value)) rejectReflectionConfig('Dream reflection config must be a JSON object.')
  assertKnownFields(value, REFLECTION_FIELDS, 'reflection')
  if ('enabled' in value) {
    if (typeof value.enabled !== 'boolean') {
      rejectReflectionConfig('reflection.enabled must be boolean.')
    }
    reflection.enabled = value.enabled
  }
  if ('model' in value && value.model !== DEFAULT_REFLECTION_MODEL) {
    rejectReflectionConfig('reflection.model must stay the current primary reflection model.')
  }
  if ('fallbackModel' in value && value.fallbackModel !== null) {
    rejectReflectionConfig('reflection.fallbackModel must stay null.')
  }
  reflection.maxOperations = readExactInteger(
    value,
    'maxOperations',
    reflection.maxOperations,
    1,
    8,
  )
  reflection.memoryCharacterBudget = readExactInteger(
    value,
    'memoryCharacterBudget',
    reflection.memoryCharacterBudget,
    1,
    REFLECTION_MEMORY_BUDGET_CAP,
  )
  reflection.transcriptCharacterBudget = readExactInteger(
    value,
    'transcriptCharacterBudget',
    reflection.transcriptCharacterBudget,
    1,
    REFLECTION_TRANSCRIPT_BUDGET_CAP,
  )
  reflection.stepCountThreshold = readExactInteger(
    value,
    'stepCountThreshold',
    reflection.stepCountThreshold,
    DEFAULT_REFLECTION_STEP_COUNT,
    REFLECTION_MAX_STEP_COUNT,
  )
  reflection.baseBackoffMinutes = readExactInteger(
    value,
    'baseBackoffMinutes',
    REFLECTION_BASE_BACKOFF_MINUTES,
    REFLECTION_BASE_BACKOFF_MINUTES,
    REFLECTION_BASE_BACKOFF_MINUTES,
  )
  reflection.maxBackoffMinutes = readExactInteger(
    value,
    'maxBackoffMinutes',
    REFLECTION_MAX_BACKOFF_MINUTES,
    REFLECTION_MAX_BACKOFF_MINUTES,
    REFLECTION_MAX_BACKOFF_MINUTES,
  )
  reflection.reflectedThroughStep = normalizeCursorMap(
    value.reflectedThroughStep,
    'reflection.reflectedThroughStep',
  )
  reflection.failures = normalizeFailureMap(value.failures)
  reflection.lastRunByConversation = normalizeTimestampMap(value.lastRunByConversation)
  return reflection
}

export const reflectionBackoffMinutes = (
  failureCount: number,
  baseMinutes = REFLECTION_BASE_BACKOFF_MINUTES,
  maxMinutes = REFLECTION_MAX_BACKOFF_MINUTES,
): number => {
  if (!Number.isInteger(failureCount) || failureCount < 1) return 0
  let delay = baseMinutes
  for (let step = 1; step < failureCount; step += 1) {
    if (delay >= maxMinutes) return maxMinutes
    const doubled = delay * 2
    delay = doubled > maxMinutes ? maxMinutes : doubled
  }
  return delay
}

const normalizeRegexDreamState = (raw: Record<string, unknown>): DreamState => {
  const state = createDefaultDreamState()
  if ('stateRevision' in raw) {
    if (
      typeof raw.stateRevision !== 'number' ||
      !Number.isSafeInteger(raw.stateRevision) ||
      raw.stateRevision < 0
    ) {
      throw new DreamStateRevisionError()
    }
    state.stateRevision = raw.stateRevision
  }
  if (typeof raw.lastRun === 'string') state.lastRun = raw.lastRun
  if (
    typeof raw.stepCountThreshold === 'number' &&
    Number.isFinite(raw.stepCountThreshold) &&
    raw.stepCountThreshold > 0
  ) {
    state.stepCountThreshold = raw.stepCountThreshold
  }
  if (isRecord(raw.lastDreamedSteps)) {
    for (const [convId, steps] of Object.entries(raw.lastDreamedSteps)) {
      if (typeof steps === 'number' && Number.isFinite(steps) && steps >= 0) {
        state.lastDreamedSteps[convId] = steps
      }
    }
  }
  if (isRecord(raw.lastRunByProject)) {
    for (const [slug, lastRun] of Object.entries(raw.lastRunByProject)) {
      if (typeof lastRun === 'string') state.lastRunByProject[slug] = lastRun
    }
  }
  return state
}

const readError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const readDreamStateFile = (): DreamStateRead => {
  if (!fs.existsSync(stateFile)) return { kind: 'missing' }
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
  } catch (error) {
    return { kind: 'corrupt', error: readError(error) }
  }
  if (!isRecord(raw)) return { kind: 'corrupt', error: 'Dream state must be a JSON object.' }
  let state: DreamState
  try {
    state = normalizeRegexDreamState(raw)
  } catch (error) {
    if (error instanceof DreamStateRevisionError) {
      return { kind: 'revision-invalid', error: error.message }
    }
    return { kind: 'corrupt', error: readError(error) }
  }
  if (!('reflection' in raw)) {
    state.reflection = createDefaultReflectionState()
    return { kind: 'valid', state }
  }
  try {
    state.reflection = normalizeReflectionState(raw.reflection)
    return { kind: 'valid', state }
  } catch (error) {
    if (error instanceof DreamReflectionConfigError) {
      state.reflection = createDefaultReflectionState()
      return {
        kind: 'reflection-invalid',
        state,
        error: error.message,
        rawReflection: raw.reflection,
      }
    }
    return { kind: 'corrupt', error: readError(error) }
  }
}

let corruptDreamStateWarned = false
let reflectionInvalidWarned = false

export function getDreamState(): DreamState {
  const read = readDreamStateFile()
  if (read.kind === 'valid') return read.state
  if (read.kind === 'revision-invalid') throw new DreamStateRevisionError(read.error)
  if (read.kind === 'reflection-invalid') {
    if (!reflectionInvalidWarned) {
      reflectionInvalidWarned = true
      console.warn(
        `⚠️ Dream reflection config at ${stateFile} is invalid (${read.error}); regex Dream will leave it unchanged and LLM reflection will refuse to run.`,
      )
    }
    return read.state
  }
  if (read.kind === 'corrupt' && !corruptDreamStateWarned) {
    corruptDreamStateWarned = true
    console.warn(
      `⚠️ Ignoring unreadable Dream state at ${stateFile} (${read.error}); it will be preserved as a .corrupt backup on the next save.`,
    )
  }
  return createDefaultDreamState()
}

const persistDreamStateUnlocked = (state: DreamState): void => {
  const existing = readDreamStateFile()
  if (existing.kind === 'revision-invalid') {
    throw new DreamStateRevisionError(existing.error)
  }
  const currentRevision =
    existing.kind === 'valid' || existing.kind === 'reflection-invalid'
      ? existing.state.stateRevision
      : 0
  if (state.stateRevision !== currentRevision) {
    throw new DreamStateConflictError(state.stateRevision, currentRevision)
  }
  if (currentRevision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Dream stateRevision exhausted the safe integer range.')
  }
  const reflection =
    existing.kind === 'reflection-invalid'
      ? existing.rawReflection
      : normalizeReflectionState(state.reflection)
  const serialized = {
    stateRevision: currentRevision + 1,
    lastRun: state.lastRun,
    stepCountThreshold: state.stepCountThreshold,
    lastDreamedSteps: state.lastDreamedSteps,
    lastRunByProject: state.lastRunByProject,
    reflection,
  }
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  if (existing.kind === 'corrupt') {
    fs.copyFileSync(stateFile, `${stateFile}.corrupt-${Date.now()}`)
  }
  const tempPath = `${stateFile}.tmp-${process.pid}-${Date.now()}`
  try {
    fs.writeFileSync(tempPath, JSON.stringify(serialized, null, 2), 'utf-8')
    fs.renameSync(tempPath, stateFile)
    state.stateRevision = serialized.stateRevision
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    throw error
  }
}

let dreamStateWriteDepth = 0

export function saveDreamState(state: DreamState): void {
  if (dreamStateWriteDepth > 0) {
    persistDreamStateUnlocked(state)
    return
  }
  const lock = acquireMemoryWriteLock(memoryRoot, 'dream state')
  dreamStateWriteDepth += 1
  try {
    persistDreamStateUnlocked(state)
  } finally {
    dreamStateWriteDepth -= 1
    releaseMemoryWriteLock(lock)
  }
}

export function shouldFireStepCountTrigger(
  convId: string,
  currentSteps: number,
  options: ScanOptions = {},
): boolean {
  const threshold = options.stepCount || DEFAULT_STEP_COUNT
  const state = getDreamState()
  const lastStep = state.lastDreamedSteps[convId] || 0
  const delta = currentSteps - lastStep
  return delta >= threshold
}

const collectDreamedIds = (evidenceDirectories: string[]): Set<string> => {
  const dreamedIds = new Set<string>()
  for (const evidenceDirectory of evidenceDirectories) {
    if (!fs.existsSync(evidenceDirectory)) continue
    const files = fs.readdirSync(evidenceDirectory).filter((file) => file.endsWith('.md'))
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(evidenceDirectory, file), 'utf-8')
        const matches = content.match(
          /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
        )
        if (matches) {
          matches.forEach((id) => {
            dreamedIds.add(id.toLowerCase())
          })
        }
        const nameMatch = file.match(/auto_dream_([0-9a-f]{8})/i)
        if (nameMatch) {
          dreamedIds.add(nameMatch[1].toLowerCase())
        }
      } catch {}
    }
  }

  return dreamedIds
}

export function getDreamedConversationIds(slug: string): Set<string> {
  return collectDreamedIds([
    path.join(memoryRoot, 'projects', slug, 'learnings'),
    path.join(memoryRoot, 'archives', 'projects', slug, 'learnings'),
  ])
}

const listProjectLearningDirectories = (projectsRoot: string): string[] => {
  if (!fs.existsSync(projectsRoot)) return []
  return fs
    .readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(projectsRoot, entry.name, 'learnings'))
}

export function getAllDreamedConversationIds(): Set<string> {
  return collectDreamedIds([
    ...listProjectLearningDirectories(path.join(memoryRoot, 'projects')),
    ...listProjectLearningDirectories(path.join(memoryRoot, 'archives', 'projects')),
  ])
}

const createScanContext = (dreamedIds: Set<string>, options: ScanOptions): PendingScanContext => ({
  minSteps: options.minSteps || 8,
  idleMinutes: options.idleMinutes || 15,
  force: Boolean(options.force),
  dreamedIds,
  dreamState: getDreamState(),
})

const isConversationDreamed = (convId: string, dreamedIds: Set<string>): boolean =>
  dreamedIds.has(convId.toLowerCase()) || dreamedIds.has(convId.slice(0, 8).toLowerCase())

const readPendingConversation = (
  convId: string,
  workspacePath: string,
  context: PendingScanContext,
  resolveSlug: () => string,
): PendingConversation | null => {
  if (isConversationDreamed(convId, context.dreamedIds)) return null

  const logPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl')
  if (!fs.existsSync(logPath)) return null

  try {
    const stat = fs.statSync(logPath)
    const ageMinutes = (Date.now() - stat.mtimeMs) / (1000 * 60)

    const content = fs.readFileSync(logPath, 'utf-8').trim()
    const lines = content.split('\n').filter(Boolean)
    if (lines.length < context.minSteps) return null
    if ((context.dreamState.lastDreamedSteps[convId] || 0) >= lines.length) return null
    if (ageMinutes < context.idleMinutes && !context.force) return null

    return {
      id: convId,
      shortId: convId.slice(0, 8).toLowerCase(),
      mtime: stat.mtime,
      ageMinutes: Math.round(ageMinutes),
      steps: lines.length,
      logPath,
      workspacePath,
      projectSlug: resolveSlug(),
    }
  } catch {
    return null
  }
}

const sortByRecency = (pending: PendingConversation[]): PendingConversation[] =>
  pending.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

const listBrainConversationIds = (): string[] =>
  fs
    .readdirSync(brainDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)

export function scanPendingConversations(
  slug: string,
  options: ScanOptions = {},
): PendingConversation[] {
  if (!fs.existsSync(brainDir)) return []
  const context = createScanContext(getDreamedConversationIds(slug), options)
  const conversationWorkspaces = readConversationWorkspaceMap()
  const pending: PendingConversation[] = []

  for (const convId of listBrainConversationIds()) {
    const workspacePath = conversationWorkspaces.get(convId)
    if (!workspacePath) continue

    const projectSlug = resolveProjectSlug(workspacePath, memoryRoot)
    if (projectSlug !== slug) continue

    const conversation = readPendingConversation(convId, workspacePath, context, () => projectSlug)
    if (conversation) pending.push(conversation)
  }

  return sortByRecency(pending)
}

export function scanAllPendingConversations(
  options: ScanOptions = {},
): Map<string, PendingConversation[]> {
  const grouped = new Map<string, PendingConversation[]>()
  if (!fs.existsSync(brainDir)) return grouped
  const context = createScanContext(getAllDreamedConversationIds(), options)
  const conversationWorkspaces = readConversationWorkspaceMap()
  const slugByWorkspace = new Map<string, string>()

  const resolveCachedSlug = (workspacePath: string): string => {
    const cached = slugByWorkspace.get(workspacePath)
    if (cached) return cached
    const resolved = resolveProjectSlug(workspacePath, memoryRoot)
    slugByWorkspace.set(workspacePath, resolved)
    return resolved
  }

  for (const convId of listBrainConversationIds()) {
    const workspacePath = conversationWorkspaces.get(convId)
    if (!workspacePath) continue

    const conversation = readPendingConversation(convId, workspacePath, context, () =>
      resolveCachedSlug(workspacePath),
    )
    if (!conversation) continue
    const group = grouped.get(conversation.projectSlug) || []
    group.push(conversation)
    grouped.set(conversation.projectSlug, group)
  }

  for (const group of grouped.values()) sortByRecency(group)
  return new Map([...grouped].sort(([a], [b]) => a.localeCompare(b)))
}

export function extractExplicitDurableLessons(logPath: string): string[] {
  const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean)
  const durableIntent =
    /\b(?:always remember|from now on|please remember|remember (?:this|that))\b|(?:จำไว้|ช่วยจำ|อย่าลืม|ต่อจากนี้|ครั้งต่อไป)/i
  const actionableSignal =
    /\b(?:always|avoid|do not|don't|must|never|prefer|require|should|use|uses|own|owns|mean|means|store|stores|keep|keeps)\b|(?:ห้าม|ต้อง|อย่า|ควร|ใช้|คือ|เป็น|เก็บ|เจ้าของ|ไม่ต้อง)/i
  const lessons: string[] = []

  for (const line of lines) {
    try {
      const step = JSON.parse(line)
      const content = step.content || ''

      if (step.type === 'USER_INPUT') {
        const rawContent = middleTruncateText(content, 4000)
        const clean = rawContent
          .replace(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/, '$1')
          .replace(/\s+/g, ' ')
          .trim()
        if (clean.length > 0 && durableIntent.test(clean)) {
          const lesson = clean
            .replace(
              /^(?:always remember(?: (?:this|that))?|from now on|please remember(?: (?:this|that))?|remember (?:this|that))\s*[:：,-]?\s*/i,
              '',
            )
            .replace(/^(?:จำไว้(?:ว่า)?|ช่วยจำ(?:ว่า)?|อย่าลืม(?:ว่า)?|ต่อจากนี้)\s*[:：,-]?\s*/i, '')
            .trim()
            .slice(0, 400)
          if (lesson.length >= 12 && actionableSignal.test(lesson) && !lessons.includes(lesson)) {
            lessons.push(lesson)
          }
        }
      }
    } catch {}
  }

  return lessons.slice(0, 5)
}

export function synthesizeConversationLearning(
  conv: PendingConversation,
  slug: string,
): string | null {
  const lessons = extractExplicitDurableLessons(conv.logPath)
  if (lessons.length === 0) return null

  const today = new Date().toISOString().split('T')[0]
  const markdown = `---
memory_status: archived
memory_kind: correction-evidence
source_conversation: ${conv.id}
workspace: ${slug}
---
# Correction Evidence: Session conv-${conv.shortId}

**Date**: ${today}
**Conversation ID**: \`[conv-${conv.id}](conversation://${conv.id})\`
**Workspace**: \`${slug}\`
**Total Steps**: ${conv.steps}
**Source**: Explicit durable-memory intent in the user conversation

---

## Explicit Actionable Corrections
${lessons.map((lesson) => `- ${lesson}`).join('\n')}
`

  return markdown
}

export function runAutoDream(
  slug: string = getProjectSlug(),
  options: ScanOptions = {},
): ProcessedDreamResult[] {
  slug = validateProjectSlug(slug)
  const pending = scanPendingConversations(slug, options)
  console.log(`\n🌙 Auto-Dream Scheduler for Workspace: "${slug}"`)
  console.log(`   Found ${pending.length} pending conversations to process.\n`)

  if (pending.length === 0) {
    console.log('✓ All conversations have already been reviewed for correction evidence.\n')
    return []
  }

  const writeLock = acquireMemoryWriteLock(memoryRoot, `dream archive ${slug}`)
  dreamStateWriteDepth += 1
  let baseRevision: string | null = null
  let memoryCommitted = false
  const changedPaths: string[] = []
  try {
    assertMemoryRepositoryCleanForWrite(memoryRoot)
    baseRevision = getMemoryHeadRevision(memoryRoot)
    if (!baseRevision) throw new Error('Dream archive requires committed MemFS HEAD.')

    const processed: ProcessedDreamResult[] = []
    const today = new Date().toISOString().split('T')[0]
    const state = getDreamState()

    for (const conv of pending) {
      console.log(
        `  ⏳ Synthesizing conv-${conv.shortId} (${conv.steps} steps, ${conv.ageMinutes}m ago)...`,
      )
      const doc = synthesizeConversationLearning(conv, slug)
      state.lastDreamedSteps[conv.id] = conv.steps
      if (!doc) {
        processed.push({
          convId: conv.id,
          shortId: conv.shortId,
          status: 'skipped',
        })
        console.log('     ↳ Skipped: no explicit durable-memory intent found.')
        continue
      }

      const relativePath = `archives/projects/${slug}/learnings/${today}_auto_dream_${conv.shortId}.md`
      const targetFile = writeMemoryFile(memoryRoot, relativePath, doc).absolutePath

      changedPaths.push(relativePath)
      processed.push({
        convId: conv.id,
        shortId: conv.shortId,
        status: 'written',
        file: targetFile,
      })
      console.log(`     ↳ Saved to ${path.relative(memoryRoot, targetFile)}`)
    }

    if (changedPaths.length > 0) {
      commitMemoryPaths({
        memoryRoot,
        relativePaths: changedPaths,
        reason: `chore(dream): archive ${changedPaths.length} explicit correction evidence note(s)`,
      })
      memoryCommitted = true
    }
    state.lastRun = new Date().toISOString()
    state.lastRunByProject[slug] = state.lastRun
    persistDreamStateUnlocked(state)
    console.log(
      `\n✓ Dream scan complete: ${changedPaths.length} written, ${processed.length - changedPaths.length} skipped.`,
    )

    return processed
  } catch (error) {
    if (!memoryCommitted && baseRevision && changedPaths.length > 0) {
      restoreDeclaredMemoryPaths(memoryRoot, baseRevision, changedPaths)
    }
    throw error
  } finally {
    dreamStateWriteDepth -= 1
    releaseMemoryWriteLock(writeLock)
  }
}

export function checkAndAutoDreamOnStepCount(
  slug: string = getProjectSlug(),
  options: ScanOptions = {},
): ProcessedDreamResult[] {
  const threshold = options.stepCount || DEFAULT_STEP_COUNT
  const pending = scanPendingConversations(slug, {
    force: true,
    minSteps: threshold,
    idleMinutes: 0,
  })
  const toProcess = pending.filter((p) =>
    shouldFireStepCountTrigger(p.id, p.steps, { stepCount: threshold }),
  )

  if (toProcess.length > 0) {
    console.log(
      `🌙 Step-Count Trigger Fired: ${toProcess.length} conversations reached >= ${threshold} steps since last reflection.`,
    )
    return runAutoDream(slug, {
      force: true,
      minSteps: threshold,
      idleMinutes: 0,
      stepCount: threshold,
    })
  }
  return []
}

const partitionProjectGroups = (
  grouped: Map<string, PendingConversation[]>,
): {
  initialized: [string, PendingConversation[]][]
  uninitialized: UninitializedDreamProject[]
} => {
  const initialized: [string, PendingConversation[]][] = []
  const uninitialized: UninitializedDreamProject[] = []
  for (const [slug, conversations] of grouped) {
    if (conversations.length === 0) continue
    if (isProjectMemoryInitialized(slug)) initialized.push([slug, conversations])
    else uninitialized.push({ slug, conversations: conversations.length })
  }
  return { initialized, uninitialized }
}

const printUninitializedProjects = (uninitialized: UninitializedDreamProject[]): void => {
  if (uninitialized.length === 0) return
  console.log('\n⚠️  Skipped projects without MemFS project memory (run /init in that workspace):')
  for (const project of uninitialized) {
    console.log(`   - ${project.slug}: not initialized (${project.conversations} conversations)`)
  }
}

const wasDreamedSinceScan = (
  conv: PendingConversation,
  state: DreamState,
  dreamedIds: Set<string>,
): boolean =>
  isConversationDreamed(conv.id, dreamedIds) || (state.lastDreamedSteps[conv.id] || 0) >= conv.steps

const commitProjectDream = (
  project: PreparedProjectDream,
  state: DreamState,
  dreamedIds: Set<string>,
): ProjectDreamOutcome => {
  const baseRevision = getMemoryHeadRevision(memoryRoot)
  if (!baseRevision) throw new Error('Dream archive requires committed MemFS HEAD.')
  const today = new Date().toISOString().split('T')[0]
  const results: ProcessedDreamResult[] = []
  const changedPaths: string[] = []
  const advancedSteps: Record<string, number> = {}
  let memoryCommitted = false
  let commitSha: string | undefined

  console.log(`\n📁 ${project.slug}`)
  try {
    for (const { conv, doc } of project.notes) {
      if (wasDreamedSinceScan(conv, state, dreamedIds)) {
        results.push({ convId: conv.id, shortId: conv.shortId, status: 'already-dreamed' })
        console.log(`  ↳ conv-${conv.shortId}: already dreamed by another run; left untouched.`)
        continue
      }
      advancedSteps[conv.id] = conv.steps
      if (!doc) {
        results.push({ convId: conv.id, shortId: conv.shortId, status: 'skipped' })
        console.log(`  ↳ conv-${conv.shortId}: skipped, no explicit durable-memory intent found.`)
        continue
      }

      const relativePath = `archives/projects/${project.slug}/learnings/${today}_auto_dream_${conv.shortId}.md`
      const targetFile = writeMemoryFile(memoryRoot, relativePath, doc).absolutePath
      changedPaths.push(relativePath)
      results.push({
        convId: conv.id,
        shortId: conv.shortId,
        status: 'written',
        file: targetFile,
      })
      console.log(`  ↳ conv-${conv.shortId}: saved to ${relativePath}`)
    }

    if (changedPaths.length > 0) {
      commitSha = commitMemoryPaths({
        memoryRoot,
        relativePaths: changedPaths,
        reason: `chore(dream): archive ${changedPaths.length} explicit correction evidence note(s) for ${project.slug}`,
      }).sha
      memoryCommitted = true
    }
  } catch (error) {
    if (!memoryCommitted && changedPaths.length > 0) {
      restoreDeclaredMemoryPaths(memoryRoot, baseRevision, changedPaths)
    }
    throw error
  }

  Object.assign(state.lastDreamedSteps, advancedSteps)
  state.lastRun = new Date().toISOString()
  state.lastRunByProject[project.slug] = state.lastRun
  saveDreamState(state)

  return { slug: project.slug, results, commitSha }
}

const printCrossProjectSummary = (report: CrossProjectDreamReport): void => {
  if (report.projects.length > 0) console.log('\n✓ Cross-project Dream complete:')
  for (const outcome of report.projects) {
    const count = (status: ProcessedDreamResult['status']): number =>
      outcome.results.filter((result) => result.status === status).length
    const commit = outcome.commitSha ? ` (commit ${outcome.commitSha.slice(0, 7)})` : ''
    console.log(
      `   - ${outcome.slug}: ${count('written')} written, ${count('skipped')} skipped, ${count('already-dreamed')} already dreamed${commit}`,
    )
  }
  printUninitializedProjects(report.uninitialized)
  console.log('')
}

export function runCrossProjectDream(
  grouped: Map<string, PendingConversation[]>,
): CrossProjectDreamReport {
  const { initialized, uninitialized } = partitionProjectGroups(grouped)
  const pendingCount = initialized.reduce((sum, [, conversations]) => sum + conversations.length, 0)
  console.log('\n🌙 Cross-Project Auto-Dream')
  console.log(
    `   Found ${pendingCount} pending conversations across ${initialized.length} initialized project(s).`,
  )

  const report: CrossProjectDreamReport = { projects: [], uninitialized }
  if (initialized.length === 0) {
    console.log('✓ No initialized project has conversations pending correction review.')
    printCrossProjectSummary(report)
    return report
  }

  const prepared: PreparedProjectDream[] = initialized.map(([slug, conversations]) => {
    const validSlug = validateProjectSlug(slug)
    return {
      slug: validSlug,
      notes: conversations.map((conv) => {
        console.log(
          `  ⏳ Synthesizing ${validSlug}/conv-${conv.shortId} (${conv.steps} steps, ${conv.ageMinutes}m ago)...`,
        )
        return { conv, doc: synthesizeConversationLearning(conv, validSlug) }
      }),
    }
  })

  const writeLock = acquireMemoryWriteLock(memoryRoot, 'dream archive all-projects')
  dreamStateWriteDepth += 1
  try {
    assertMemoryRepositoryCleanForWrite(memoryRoot)
    const state = getDreamState()
    const dreamedIds = getAllDreamedConversationIds()
    for (const project of prepared) {
      report.projects.push(commitProjectDream(project, state, dreamedIds))
    }
  } finally {
    dreamStateWriteDepth -= 1
    releaseMemoryWriteLock(writeLock)
  }

  printCrossProjectSummary(report)
  return report
}

export function runProjectDream(slug: string, options: ScanOptions = {}): CrossProjectDreamReport {
  const validSlug = validateProjectSlug(slug)
  const grouped = scanAllPendingConversations(options)
  const conversations = grouped.get(validSlug)
  if (!conversations || conversations.length === 0) {
    const knownSlugs = [...grouped.keys()]
    console.log(`\n🌙 0 conversations mapped to ${validSlug}.`)
    console.log(
      knownSlugs.length > 0
        ? `   Projects with pending conversations: ${knownSlugs.join(', ')}\n`
        : '   No project has pending conversations.\n',
    )
    return { projects: [], uninitialized: [] }
  }
  return runCrossProjectDream(new Map([[validSlug, conversations]]))
}

const pendingDreamProposalCount = (): number =>
  listPendingProposals().filter((proposal) => proposal.author === DREAM_REFLECTION_AUTHOR).length

const reflectionRetryAt = (
  failure: DreamReflectionFailure | undefined,
  reflection: DreamReflectionState,
): number | null => {
  if (!failure || failure.count < 1) return null
  const lastAt = Date.parse(failure.lastAt)
  if (!Number.isFinite(lastAt)) return null
  return (
    lastAt +
    reflectionBackoffMinutes(
      failure.count,
      reflection.baseBackoffMinutes,
      reflection.maxBackoffMinutes,
    ) *
      60_000
  )
}

const scopedReflectionCandidates = (
  scope: DreamCliScope,
  workspaceDir?: string,
): ReflectionCandidate[] => {
  const currentSlug = scope.kind === 'current' ? getProjectSlug(workspaceDir) : null
  return readReflectionCandidates().filter((candidate) => {
    if (!isProjectMemoryInitialized(candidate.projectSlug)) return false
    if (scope.kind === 'all-projects') return true
    if (scope.kind === 'project') return candidate.projectSlug === scope.slug
    return candidate.projectSlug === currentSlug
  })
}

const invalidReflectionReport = (configError: string): DreamReflectionStatusReport => ({
  config: 'invalid',
  configError,
  enabled: null,
  model: null,
  fallbackModel: null,
  stepCountThreshold: null,
  baseBackoffMinutes: null,
  maxBackoffMinutes: null,
  maxOperations: null,
  memoryCharacterBudget: null,
  transcriptCharacterBudget: null,
  schedule: 'not-inspected',
  eligibleConversationCount: 0,
  pendingProposalCount: pendingDreamProposalCount(),
  conversations: [],
})

export function inspectDreamReflectionStatus(
  scope: DreamCliScope,
  options: { now?: number; workspaceDir?: string } = {},
): DreamReflectionStatusReport {
  const read = readDreamStateFile()
  if (
    read.kind === 'corrupt' ||
    read.kind === 'reflection-invalid' ||
    read.kind === 'revision-invalid'
  ) {
    return invalidReflectionReport(read.error)
  }
  const state = read.kind === 'missing' ? createDefaultDreamState() : read.state
  const now = options.now ?? Date.now()
  const reflection = state.reflection
  const conversations = scopedReflectionCandidates(scope, options.workspaceDir)
    .map((candidate): DreamReflectionConversationStatus => {
      const cursor = reflection.reflectedThroughStep[candidate.id] ?? 0
      const failure = reflection.failures[candidate.id]
      const retryAt = reflectionRetryAt(failure, reflection)
      const lag = Math.max(candidate.lines.length - cursor, 0)
      return {
        conversationId: candidate.id,
        projectSlug: candidate.projectSlug,
        cursor,
        steps: candidate.lines.length,
        lag,
        consecutiveFailures: failure?.count ?? 0,
        latestFailureCode: failure?.code ?? null,
        latestFailureAt: failure?.lastAt ?? null,
        nextEligibleAt: retryAt !== null && now < retryAt ? new Date(retryAt).toISOString() : null,
      }
    })
    .sort((left, right) => left.conversationId.localeCompare(right.conversationId))
  return {
    config: 'valid',
    configError: null,
    enabled: reflection.enabled,
    model: reflection.model,
    fallbackModel: reflection.fallbackModel,
    stepCountThreshold: reflection.stepCountThreshold,
    baseBackoffMinutes: reflection.baseBackoffMinutes,
    maxBackoffMinutes: reflection.maxBackoffMinutes,
    maxOperations: reflection.maxOperations,
    memoryCharacterBudget: reflection.memoryCharacterBudget,
    transcriptCharacterBudget: reflection.transcriptCharacterBudget,
    schedule: 'not-inspected',
    eligibleConversationCount: conversations.filter(
      (conversation) =>
        conversation.lag >= reflection.stepCountThreshold && conversation.nextEligibleAt === null,
    ).length,
    pendingProposalCount: pendingDreamProposalCount(),
    conversations,
  }
}

const printReflectionReport = (report: DreamReflectionStatusReport): void => {
  console.log('🌙 LLM Reflection')
  console.log('   Schedule installation: not inspected')
  console.log('   Manual --run-now --llm: operator override')
  if (report.config === 'invalid') {
    console.log(`   Config: invalid (${report.configError})`)
    console.log('   Cursors withheld until the reflection config is valid.')
    console.log(`   Pending Dream proposals: ${report.pendingProposalCount}`)
    return
  }
  console.log(
    `   Automatic/scheduled LLM: ${report.enabled ? 'on' : 'off'} (reflection.enabled=${report.enabled ? 'true' : 'false'})`,
  )
  console.log(`   Model: ${report.model}`)
  console.log(`   Fallback: ${report.fallbackModel ?? 'none'}`)
  console.log(`   Step threshold: ${report.stepCountThreshold}`)
  console.log(
    `   Backoff minutes: ${report.baseBackoffMinutes} then doubles through ${report.maxBackoffMinutes}`,
  )
  console.log(`   Automatic eligible conversations: ${report.eligibleConversationCount}`)
  console.log(`   Pending Dream proposals: ${report.pendingProposalCount}`)
  for (const conversation of report.conversations) {
    const next = conversation.nextEligibleAt ?? 'ready'
    const latest = conversation.latestFailureCode
      ? `${conversation.latestFailureCode} at ${conversation.latestFailureAt}`
      : 'none'
    console.log(
      `   - ${conversation.conversationId} cursor=${conversation.cursor} lag=${conversation.lag} failures=${conversation.consecutiveFailures} latest=${latest} next=${next}`,
    )
  }
}

export function printAllProjectsStatus(): void {
  const grouped = scanAllPendingConversations({ force: true, idleMinutes: 0 })
  const { initialized, uninitialized } = partitionProjectGroups(grouped)
  const state = getDreamState()

  console.log('\n🌙 Auto-Dream Status for All Projects')
  console.log(`   Step-Count Trigger Threshold: ${state.stepCountThreshold} steps`)
  console.log(`   Last Auto-Dream Run: ${state.lastRun || 'Never'}`)

  if (initialized.length === 0) {
    console.log('\n✓ No initialized project has pending undreamed sessions.')
  } else {
    console.log('\n📋 Pending Sessions by Project:')
    for (const [slug, conversations] of initialized) {
      const triggered = conversations.filter((conv) =>
        shouldFireStepCountTrigger(conv.id, conv.steps),
      ).length
      console.log(
        `   - ${slug}: ${conversations.length} pending, ${triggered} at step trigger (last run: ${state.lastRunByProject[slug] || 'Never'})`,
      )
    }
    console.log(
      '\nRun `node dream-daemon.ts --run-now --all-projects` or `--run-now --project <slug>` to process them.',
    )
  }
  printUninitializedProjects(uninitialized)
  console.log('')
  printReflectionReport(inspectDreamReflectionStatus({ kind: 'all-projects' }))
  console.log('')
}

export function parseDreamCliScope(args: string[]): DreamCliScope {
  const allProjects = args.includes('--all-projects')
  const projectIndex = args.indexOf('--project')
  if (projectIndex === -1) return allProjects ? { kind: 'all-projects' } : { kind: 'current' }
  if (allProjects) throw new Error('Use either --all-projects or --project <slug>, not both.')
  const value = args[projectIndex + 1]
  if (!value || value.startsWith('--')) throw new Error('--project requires a project slug.')
  return { kind: 'project', slug: validateProjectSlug(value) }
}

export function printStatus(slug: string = getProjectSlug()): void {
  const pending = scanPendingConversations(slug, { force: true, idleMinutes: 0 })
  const dreamed = getDreamedConversationIds(slug)
  const state = getDreamState()

  console.log(`\n🌙 Auto-Dream Status for Workspace: "${slug}"`)
  console.log(`   MemFS Directory: ${path.join(memoryRoot, 'projects', slug)}`)
  console.log(`   Step-Count Trigger Threshold: ${state.stepCountThreshold} steps`)
  console.log(`   Last Auto-Dream Run: ${state.lastRun || 'Never'}`)
  console.log(`   Total Dreamed Sessions: ${dreamed.size}`)
  console.log(`   Pending Undreamed Sessions: ${pending.length}\n`)

  if (pending.length > 0) {
    console.log('📋 Pending Sessions Queue:')
    pending.slice(0, 10).forEach((p, i) => {
      const willTrigger = shouldFireStepCountTrigger(p.id, p.steps)
      const triggerIcon = willTrigger ? '⚡ [Step Trigger]' : '⏳'
      console.log(
        `   [${i + 1}] conv-${p.shortId} (${p.steps} steps, ${p.ageMinutes}m ago) ${triggerIcon}`,
      )
    })
    console.log('\nRun `node dream-daemon.ts --run-now` to process them immediately.\n')
  } else {
    console.log('✓ All conversation sessions are up to date in MemFS.\n')
  }
  printReflectionReport(inspectDreamReflectionStatus({ kind: 'project', slug }))
  console.log('')
}

export type DreamLlmStatus = 'advanced' | 'skipped' | 'failed'

export type DreamCurationRecord = {
  path: string
  description: string
}

export type DreamReflectionReceipt = {
  version: 1
  promptSha256: string
  transcriptSha256: string
  responseSha256: string | null
  requestedModel: string
  outcome: string
  proposalIds: string[]
  startCursor: number
  capturedThroughStep: number
  hostIsolation: typeof AGY_HOST_ISOLATION
  cliVersion: string | null
}

export type DreamLlmRunResult = {
  mode: 'llm'
  status: DreamLlmStatus
  code: string
  conversationId: string | null
  projectSlug: string | null
  capturedThroughStep: number | null
  proposalIds: string[]
  curationRequired: DreamCurationRecord[]
  message: string
  receipt: DreamReflectionReceipt | null
}

export type DreamRunOptions = ScanOptions & {
  llm?: boolean
  transport?: ReflectionTransport
  workspaceDir?: string
  beforePersistProposal?: (index: number) => void
  beforeOwnedReflectionWrite?: () => void
  beforePersistReceipt?: (receipt: DreamReflectionReceipt) => void
  beforeReleaseReservation?: () => void
  now?: () => number
}

export type DreamDispatch =
  | { mode: 'regex'; report: ProcessedDreamResult[] | CrossProjectDreamReport }
  | { mode: 'llm'; result: DreamLlmRunResult }

export const dreamLlmExitCode = (result: DreamLlmRunResult): 0 | 1 =>
  result.status === 'failed' ||
  result.code === 'ADVANCED_RECEIPT_FAILED' ||
  result.code === 'RESERVATION_RELEASE_FAILED'
    ? 1
    : 0

const PATH_REJECTION_CODES = new Set<ReflectionRejectionCode>([
  'UNSAFE_PATH',
  'ARCHIVE_PATH',
  'REFERENCE_PATH',
  'HIDDEN_PATH',
  'STATE_PATH',
  'NON_MARKDOWN',
  'CROSS_PROJECT',
  'NON_ACTIVE_OWNER',
  'MISSING_SNAPSHOT',
  'EMPTY_DESTRUCTIVE_WRITE',
  'ANTI_LOSS',
  'DUPLICATE_PATH',
])

const MALFORMED_REJECTION_CODES = new Set<ReflectionRejectionCode>([
  'MALFORMED_JSON',
  'DUPLICATE_JSON_KEY',
  'MALFORMED_UNICODE',
])

const llmResult = (
  status: DreamLlmStatus,
  code: string,
  message: string,
  extra: Partial<
    Pick<
      DreamLlmRunResult,
      | 'conversationId'
      | 'projectSlug'
      | 'capturedThroughStep'
      | 'proposalIds'
      | 'curationRequired'
      | 'receipt'
    >
  > = {},
): DreamLlmRunResult => ({
  mode: 'llm',
  status,
  code,
  message,
  conversationId: extra.conversationId ?? null,
  projectSlug: extra.projectSlug ?? null,
  capturedThroughStep: extra.capturedThroughStep ?? null,
  proposalIds: extra.proposalIds ?? [],
  curationRequired: extra.curationRequired ?? [],
  receipt: extra.receipt ?? null,
})

type DreamGuardCode = 'SNAPSHOT_CONFLICT' | 'SNAPSHOT_OWNER_MISSING' | 'TRANSCRIPT_OVERFLOW'

class DreamReflectionGuardError extends Error {
  readonly code: DreamGuardCode

  constructor(code: DreamGuardCode, message: string) {
    super(message)
    this.name = 'DreamReflectionGuardError'
    this.code = code
  }
}

const failureCode = (error: unknown): { code: string; message: string } => {
  if (error instanceof ReflectionTransportError) return { code: error.code, message: error.message }
  if (error instanceof ReflectionRejectedError) {
    if (MALFORMED_REJECTION_CODES.has(error.code))
      return { code: 'MALFORMED', message: error.message }
    if (PATH_REJECTION_CODES.has(error.code)) return { code: 'PATH', message: error.message }
    return { code: 'SCHEMA', message: error.message }
  }
  if (error instanceof MemoryProposalSetError) {
    return {
      code: error.code === 'HEAD_RACE' ? 'HEAD_RACE' : 'PROPOSAL_FAILED',
      message: error.message,
    }
  }
  if (error instanceof DreamReflectionGuardError)
    return { code: error.code, message: error.message }
  if (error instanceof Error && error.message === 'SNAPSHOT_RACE') {
    return {
      code: 'SNAPSHOT_RACE',
      message: 'MemFS HEAD changed while the reflection snapshot was read.',
    }
  }
  return {
    code: 'PROPOSAL_FAILED',
    message: error instanceof Error ? error.message : String(error),
  }
}

type ReflectionCandidate = {
  id: string
  projectSlug: string
  mtimeMs: number
  lines: string[]
}

const readCompleteTranscriptLines = (logPath: string): string[] => {
  const raw = fs.readFileSync(logPath, 'utf-8')
  const records = raw.split('\n')
  if (!raw.endsWith('\n')) records.pop()

  const lines: string[] = []
  for (const rawLine of records) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line.trim()) continue
    try {
      if (!isRecord(JSON.parse(line))) break
    } catch {
      break
    }
    lines.push(line)
  }
  return lines
}

const readReflectionCandidates = (): ReflectionCandidate[] => {
  if (!fs.existsSync(brainDir)) return []
  const workspaces = readConversationWorkspaceMap()
  const candidates: ReflectionCandidate[] = []
  for (const convId of listBrainConversationIds()) {
    const workspacePath = workspaces.get(convId)
    if (!workspacePath) continue
    const logPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl')
    if (!fs.existsSync(logPath)) continue
    try {
      const stat = fs.statSync(logPath)
      const lines = readCompleteTranscriptLines(logPath)
      candidates.push({
        id: convId,
        projectSlug: resolveProjectSlug(workspacePath, memoryRoot),
        mtimeMs: stat.mtimeMs,
        lines,
      })
    } catch {}
  }
  return candidates
}

const selectReflectionCandidate = (
  scope: DreamCliScope,
  options: DreamRunOptions,
  state: DreamState,
  nowMs: number,
): { candidate: ReflectionCandidate; cursor: number } | DreamLlmRunResult => {
  const currentSlug = scope.kind === 'current' ? getProjectSlug(options.workspaceDir) : null
  const scoped = readReflectionCandidates().filter((candidate) => {
    if (scope.kind === 'all-projects') return true
    if (scope.kind === 'project') return candidate.projectSlug === scope.slug
    return candidate.projectSlug === currentSlug
  })
  const initialized = scoped.filter((candidate) =>
    isProjectMemoryInitialized(candidate.projectSlug),
  )
  if (scope.kind !== 'all-projects') {
    const slug = scope.kind === 'project' ? scope.slug : currentSlug
    if (slug && !isProjectMemoryInitialized(slug)) {
      return llmResult(
        'skipped',
        'SKIPPED_UNINITIALIZED',
        'LLM reflection requires initialized committed project memory.',
        { projectSlug: slug },
      )
    }
  } else if (scoped.length > 0 && initialized.length === 0) {
    return llmResult(
      'skipped',
      'SKIPPED_UNINITIALIZED',
      'LLM reflection requires initialized committed project memory.',
    )
  }

  const ranked = initialized
    .map((candidate) => ({
      candidate,
      cursor: state.reflection.reflectedThroughStep[candidate.id] ?? 0,
    }))
    .filter(({ candidate, cursor }) => {
      const delta = candidate.lines.length - cursor
      return delta >= state.reflection.stepCountThreshold
    })
    .sort(
      (left, right) =>
        right.candidate.mtimeMs - left.candidate.mtimeMs ||
        left.candidate.id.localeCompare(right.candidate.id),
    )
  const ready = ranked.filter(({ candidate }) => {
    // --force bypasses only this backoff clock. It does not lower the step gate
    // or skip schema, snapshot, approval, or lock checks.
    if (options.force) return true
    const retryAt = reflectionRetryAt(state.reflection.failures[candidate.id], state.reflection)
    return retryAt === null || nowMs >= retryAt
  })
  const selected = ready[0]
  if (selected) return selected
  const blocked = ranked[0]
  if (blocked && !options.force) {
    const retryAt = reflectionRetryAt(
      state.reflection.failures[blocked.candidate.id],
      state.reflection,
    )
    if (retryAt !== null && nowMs < retryAt) {
      return llmResult(
        'skipped',
        'SKIPPED_BACKOFF',
        `Reflection backoff is active until ${new Date(retryAt).toISOString()}.`,
        { conversationId: blocked.candidate.id, projectSlug: blocked.candidate.projectSlug },
      )
    }
  }
  return llmResult('skipped', 'SKIPPED_NO_SLICE', 'No unreflected transcript slice is eligible.')
}

const readReflectionSnapshot = (
  slug: string,
): { head: string; snapshot: CommittedMemorySnapshot } => {
  assertMemoryRepositoryCleanForWrite(memoryRoot)
  const head = getMemoryHeadRevision(memoryRoot)
  if (!head) throw new Error('Dream reflection requires committed MemFS HEAD.')
  const projection = inspectCommittedMemoryProjection(memoryRoot, slug)
  if (getMemoryHeadRevision(memoryRoot) !== head || projection.revision !== head) {
    throw new Error('SNAPSHOT_RACE')
  }
  assertMemoryRepositoryCleanForWrite(memoryRoot)
  if (projection.mode === 'conflict') {
    throw new DreamReflectionGuardError(
      'SNAPSHOT_CONFLICT',
      'Committed active memory is in layered/legacy conflict, so no reflection snapshot was built.',
    )
  }
  const paths = [...projection.globalSystem, ...projection.projectSystem]
    .map((document) => document.relativePath)
    .sort((left, right) => left.localeCompare(right))
  const files = paths.map((relativePath) => {
    const body = readCommittedMemoryFile(memoryRoot, relativePath)
    if (getMemoryHeadRevision(memoryRoot) !== head) throw new Error('SNAPSHOT_RACE')
    if (body === null) {
      throw new DreamReflectionGuardError(
        'SNAPSHOT_OWNER_MISSING',
        `Committed active memory owner disappeared before its raw content was read: ${relativePath}`,
      )
    }
    return { path: relativePath, body }
  })
  if (getMemoryHeadRevision(memoryRoot) !== head) throw new Error('SNAPSHOT_RACE')
  assertMemoryRepositoryCleanForWrite(memoryRoot)
  return { head, snapshot: { files } }
}

const selectTranscriptPrefix = (
  lines: readonly string[],
  cursor: number,
  budget: number,
): { text: string; capturedThroughStep: number } => {
  const included: string[] = []
  let usedCodePoints = 0
  for (const line of lines.slice(cursor)) {
    const lineCodePoints = boundTextByCodePoints(line, 0).totalCodePoints
    const separatorCodePoints = included.length === 0 ? 0 : 1
    if (usedCodePoints + separatorCodePoints + lineCodePoints > budget) break
    usedCodePoints += separatorCodePoints + lineCodePoints
    included.push(line)
  }
  if (included.length === 0) {
    throw new DreamReflectionGuardError(
      'TRANSCRIPT_OVERFLOW',
      'The next complete transcript line exceeds the transcript budget, so the cursor was left unchanged.',
    )
  }
  return { text: included.join('\n'), capturedThroughStep: cursor + included.length }
}

const REFLECTION_RECEIPT_FILE = 'reflection-receipt.json'
const NON_BACKOFF_CODES = new Set([
  'RESERVATION_LIVE',
  'RESERVATION_DEAD',
  'RESERVATION_AMBIGUOUS',
  'RESERVATION_LOST',
  'TRANSCRIPT_PREFIX_CHANGED',
  'CURSOR_MOVED',
  'LOCK_CONTENTION',
])

const sha256Text = (value: string): string =>
  crypto.createHash('sha256').update(value, 'utf8').digest('hex')

const reflectionReceiptPath = (): string => path.join(memoryStateRoot, REFLECTION_RECEIPT_FILE)

const writeReflectionReceipt = (receipt: DreamReflectionReceipt): void => {
  fs.mkdirSync(memoryStateRoot, { recursive: true })
  const target = reflectionReceiptPath()
  const tempPath = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    fs.renameSync(tempPath, target)
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    throw error
  }
}

const observedCliVersion = (transport: ReflectionTransport): string | null => {
  if (!('observedCliVersion' in transport)) return null
  const value = (transport as { observedCliVersion?: unknown }).observedCliVersion
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value : null
}

type BoundReflectionSlice = {
  conversationId: string
  startCursor: number
  lines: string[]
  completePrefixSha256: string
  capturedThroughStep: number
  logPath: string
}

const reflectionCursor = (conversationId: string): number | null => {
  const read = readDreamStateFile()
  if (read.kind !== 'valid' && read.kind !== 'missing') return null
  const state = read.kind === 'valid' ? read.state : createDefaultDreamState()
  return state.reflection.reflectedThroughStep[conversationId] ?? 0
}

const verifyBoundSlice = (bound: BoundReflectionSlice): 'ok' | 'transcript' | 'cursor' => {
  const current = reflectionCursor(bound.conversationId)
  if (current === null || current !== bound.startCursor) return 'cursor'
  let lines: string[]
  try {
    lines = readCompleteTranscriptLines(bound.logPath)
  } catch {
    return 'transcript'
  }
  const completePrefix = lines.slice(0, bound.capturedThroughStep)
  if (completePrefix.length !== bound.capturedThroughStep) return 'transcript'
  if (sha256Text(completePrefix.join('\n')) !== bound.completePrefixSha256) return 'transcript'
  const captured = lines.slice(bound.startCursor, bound.capturedThroughStep)
  if (captured.length !== bound.lines.length) return 'transcript'
  for (let index = 0; index < bound.lines.length; index += 1) {
    if (captured[index] !== bound.lines[index]) return 'transcript'
  }
  return 'ok'
}

type OwnedReflectionWriteResult =
  | { status: 'applied' }
  | { status: 'cursor-moved'; current: number }
  | { status: 'config-unchanged' }

const ownedCursor = (state: DreamState, conversationId: string): number =>
  state.reflection.reflectedThroughStep[conversationId] ?? 0

const loadWritableDreamState = ():
  | { status: 'config-unchanged' }
  | { status: 'ready'; state: DreamState } => {
  const read = readDreamStateFile()
  if (
    read.kind === 'corrupt' ||
    read.kind === 'reflection-invalid' ||
    read.kind === 'revision-invalid'
  ) {
    return { status: 'config-unchanged' }
  }
  return {
    status: 'ready',
    state: read.kind === 'missing' ? createDefaultDreamState() : read.state,
  }
}

const applyOwnedReflectionPatch = (write: {
  conversationId: string
  expectedCursor: number
  apply: (state: DreamState) => void
  barrier?: () => void
}): OwnedReflectionWriteResult => {
  const first = loadWritableDreamState()
  if (first.status === 'config-unchanged') return first
  const current = ownedCursor(first.state, write.conversationId)
  if (current !== write.expectedCursor) return { status: 'cursor-moved', current }
  write.barrier?.()
  const latest = loadWritableDreamState()
  if (latest.status === 'config-unchanged') return latest
  const latestCursor = ownedCursor(latest.state, write.conversationId)
  if (latestCursor !== write.expectedCursor)
    return { status: 'cursor-moved', current: latestCursor }
  write.apply(latest.state)
  persistDreamStateUnlocked(latest.state)
  return { status: 'applied' }
}

const withDreamStateLock = <T>(operation: string, body: () => T): T | 'lock-contention' => {
  if (dreamStateWriteDepth > 0) return body()
  let lock: ReturnType<typeof acquireMemoryWriteLock>
  try {
    lock = acquireMemoryWriteLock(memoryRoot, operation)
  } catch (error) {
    if (error instanceof MemoryWriteLockError) return 'lock-contention'
    throw error
  }
  dreamStateWriteDepth += 1
  try {
    return body()
  } finally {
    dreamStateWriteDepth -= 1
    releaseMemoryWriteLock(lock)
  }
}

const recordReflectionFailure = (
  conversationId: string,
  code: string,
  nowMs: number,
  expectedCursor: number,
  barrier?: () => void,
): 'recorded' | 'skipped' | 'cursor-moved' | 'config-unchanged' | 'lock-contention' => {
  if (!FAILURE_CODE_PATTERN.test(code) || NON_BACKOFF_CODES.has(code)) return 'skipped'
  const locked = withDreamStateLock(`dream reflection failure ${conversationId}`, () =>
    applyOwnedReflectionPatch({
      conversationId,
      expectedCursor,
      barrier,
      apply: (state) => {
        const previous = state.reflection.failures[conversationId]?.count ?? 0
        state.reflection.failures[conversationId] = {
          count: Math.min(previous + 1, REFLECTION_MAX_FAILURE_COUNT),
          lastAt: new Date(nowMs).toISOString(),
          code,
        }
      },
    }),
  )
  if (locked === 'lock-contention') return 'lock-contention'
  if (locked.status === 'applied') return 'recorded'
  if (locked.status === 'cursor-moved') return 'cursor-moved'
  return 'config-unchanged'
}

const reservationBlocked = (
  acquired: Exclude<ReflectionReservationAcquire, { status: 'acquired' }>,
  candidate: ReflectionCandidate,
): DreamLlmRunResult => {
  const context = { conversationId: candidate.id, projectSlug: candidate.projectSlug }
  if (acquired.status === 'live') {
    return llmResult(
      'skipped',
      'RESERVATION_LIVE',
      'Another live reflection reservation is active. Transport was not called.',
      context,
    )
  }
  if (acquired.status === 'dead') {
    return llmResult(
      'skipped',
      'RESERVATION_DEAD',
      'A dead reflection reservation remains and was not deleted. Crash-after-proposal is not automatic replay; inspect it and any pending proposals before reclaiming with the owner token.',
      context,
    )
  }
  return llmResult(
    'skipped',
    'RESERVATION_AMBIGUOUS',
    'The reflection reservation is unreadable or unusable and remains in place.',
    context,
  )
}

const ownsReservation = (reservation: ReflectionReservation): boolean => {
  const inspected = inspectReflectionReservation(memoryStateRoot)
  return (
    inspected.status === 'live' &&
    inspected.reservation.token === reservation.token &&
    inspected.reservation.pid === reservation.pid
  )
}

const runLlmReflection = (scope: DreamCliScope, options: DreamRunOptions): DreamLlmRunResult => {
  const nowMs = options.now?.() ?? Date.now()
  let retainReservation = false
  let providerStarted = false
  let boundCursor: number | null = null
  let owned: ReflectionReservation | null = null
  const lockContention = (
    message: string,
    extra: Partial<
      Pick<
        DreamLlmRunResult,
        | 'conversationId'
        | 'projectSlug'
        | 'capturedThroughStep'
        | 'proposalIds'
        | 'curationRequired'
        | 'receipt'
      >
    > = {},
  ): DreamLlmRunResult => {
    retainReservation = owned !== null
    return llmResult('failed', 'LOCK_CONTENTION', message, extra)
  }
  const fail = (
    code: string,
    message: string,
    extra: Partial<
      Pick<
        DreamLlmRunResult,
        | 'conversationId'
        | 'projectSlug'
        | 'capturedThroughStep'
        | 'proposalIds'
        | 'curationRequired'
        | 'receipt'
      >
    > = {},
  ): DreamLlmRunResult => {
    if (
      extra.conversationId &&
      boundCursor !== null &&
      FAILURE_CODE_PATTERN.test(code) &&
      !NON_BACKOFF_CODES.has(code)
    ) {
      const recorded = recordReflectionFailure(
        extra.conversationId,
        code,
        nowMs,
        boundCursor,
        options.beforeOwnedReflectionWrite,
      )
      if (recorded === 'lock-contention') {
        return lockContention(
          providerStarted
            ? 'Writer lock contention blocked reflection failure persistence. Transport was not called again. The reservation remains for inspect or recovery.'
            : 'Writer lock contention blocked reflection failure persistence. Transport was not called.',
          extra,
        )
      }
    }
    return llmResult('failed', code, message, extra)
  }

  if (process.env[AGY_REFLECTION_CHILD_ENV] === '1') {
    return fail('RECURSIVE_CHILD', 'Refusing a nested Dream v2 reflection child.')
  }
  if (!options.transport) {
    return fail(
      'NO_TRANSPORT',
      'LLM reflection requires an explicit transport and does not fall back to regex Dream.',
    )
  }
  const loaded = readDreamStateFile()
  if (
    loaded.kind === 'reflection-invalid' ||
    loaded.kind === 'revision-invalid' ||
    loaded.kind === 'corrupt'
  ) {
    return fail('CONFIG_INVALID', loaded.error)
  }

  const selected = selectReflectionCandidate(scope, options, getDreamState(), nowMs)
  if ('status' in selected) return selected
  const candidate = selected.candidate
  const releaseOwnedReservation = (): ReturnType<typeof releaseReflectionReservation> => {
    options.beforeReleaseReservation?.()
    if (!owned) return { status: 'absent' }
    return releaseReflectionReservation(memoryStateRoot, owned.token)
  }
  let result: DreamLlmRunResult
  try {
    result = (() => {
      const acquired = acquireReflectionReservation(memoryStateRoot, candidate.id)
      if (acquired.status === 'lock-contention') {
        return llmResult(
          'failed',
          'LOCK_CONTENTION',
          'Writer lock contention blocked the reflection reservation. Transport was not called.',
          { conversationId: candidate.id, projectSlug: candidate.projectSlug },
        )
      }
      if (acquired.status !== 'acquired') return reservationBlocked(acquired, candidate)
      owned = acquired.reservation

      const fresh = readDreamStateFile()
      if (
        fresh.kind === 'reflection-invalid' ||
        fresh.kind === 'revision-invalid' ||
        fresh.kind === 'corrupt'
      ) {
        return fail('CONFIG_INVALID', fresh.error)
      }
      const state = fresh.kind === 'valid' ? fresh.state : createDefaultDreamState()
      const freshCandidate = readReflectionCandidates().find((entry) => entry.id === candidate.id)
      if (!freshCandidate) {
        return llmResult(
          'skipped',
          'SKIPPED_NO_SLICE',
          'No unreflected transcript slice is eligible.',
          { conversationId: candidate.id, projectSlug: candidate.projectSlug },
        )
      }
      const startCursor = state.reflection.reflectedThroughStep[freshCandidate.id] ?? 0
      boundCursor = startCursor
      if (freshCandidate.lines.length - startCursor < state.reflection.stepCountThreshold) {
        return llmResult(
          'skipped',
          'SKIPPED_NO_SLICE',
          'No unreflected transcript slice is eligible.',
          { conversationId: freshCandidate.id, projectSlug: freshCandidate.projectSlug },
        )
      }
      if (!options.force) {
        const retryAt = reflectionRetryAt(
          state.reflection.failures[freshCandidate.id],
          state.reflection,
        )
        if (retryAt !== null && nowMs < retryAt) {
          return llmResult(
            'skipped',
            'SKIPPED_BACKOFF',
            `Reflection backoff is active until ${new Date(retryAt).toISOString()}.`,
            { conversationId: freshCandidate.id, projectSlug: freshCandidate.projectSlug },
          )
        }
      }

      const reflection = state.reflection
      let prefix: ReturnType<typeof selectTranscriptPrefix>
      try {
        prefix = selectTranscriptPrefix(
          freshCandidate.lines,
          startCursor,
          reflection.transcriptCharacterBudget,
        )
      } catch (error) {
        const failure = failureCode(error)
        return fail(failure.code, failure.message, {
          conversationId: freshCandidate.id,
          projectSlug: freshCandidate.projectSlug,
        })
      }
      const bound: BoundReflectionSlice = {
        conversationId: freshCandidate.id,
        startCursor,
        lines: freshCandidate.lines.slice(startCursor, prefix.capturedThroughStep),
        completePrefixSha256: sha256Text(
          freshCandidate.lines.slice(0, prefix.capturedThroughStep).join('\n'),
        ),
        capturedThroughStep: prefix.capturedThroughStep,
        logPath: path.join(
          brainDir,
          freshCandidate.id,
          '.system_generated',
          'logs',
          'transcript.jsonl',
        ),
      }
      const context = {
        conversationId: freshCandidate.id,
        projectSlug: freshCandidate.projectSlug,
        capturedThroughStep: prefix.capturedThroughStep,
      }

      let head = ''
      let snapshot: CommittedMemorySnapshot
      try {
        const captured = readReflectionSnapshot(freshCandidate.projectSlug)
        head = captured.head
        snapshot = captured.snapshot
      } catch (error) {
        const failure = failureCode(error)
        return fail(failure.code, failure.message, context)
      }
      if (!ownsReservation(owned)) {
        return llmResult(
          'skipped',
          'RESERVATION_LOST',
          'The reflection reservation changed before transport and was left in place.',
          context,
        )
      }

      const prompt = buildReflectionPrompt(
        snapshot,
        { conversationId: freshCandidate.id, text: prefix.text },
        freshCandidate.projectSlug,
        {
          maxOperations: reflection.maxOperations,
          memoryCodePointBudget: reflection.memoryCharacterBudget,
          transcriptCodePointBudget: reflection.transcriptCharacterBudget,
        },
      )
      const promptSha256 = sha256Text(prompt)
      const transcriptSha256 = sha256Text(prefix.text)
      const receiptFor = (
        outcome: string,
        responseSha256: string | null,
        proposalIds: string[],
      ): DreamReflectionReceipt => ({
        version: 1,
        promptSha256,
        transcriptSha256,
        responseSha256,
        requestedModel: reflection.model,
        outcome,
        proposalIds,
        startCursor,
        capturedThroughStep: prefix.capturedThroughStep,
        hostIsolation: AGY_HOST_ISOLATION,
        cliVersion: observedCliVersion(options.transport as ReflectionTransport),
      })
      const persistReceipt = (receipt: DreamReflectionReceipt): void => {
        options.beforePersistReceipt?.(receipt)
        writeReflectionReceipt(receipt)
      }

      const runDirectory = createReflectionRunDirectory()
      let raw = ''
      let responseSha256: string | null = null
      let transportError: unknown = null
      try {
        fs.writeFileSync(path.join(runDirectory.directory, 'prompt.txt'), prompt, { mode: 0o600 })
        fs.writeFileSync(path.join(runDirectory.directory, 'transcript.txt'), prefix.text, {
          mode: 0o600,
        })
        providerStarted = true
        raw = options.transport.reflect({
          prompt,
          model: reflection.model,
          jsonSchema: reflectionResponseJsonSchema(reflection.maxOperations),
          cwd: runDirectory.directory,
        })
        responseSha256 = sha256Text(raw)
        fs.writeFileSync(path.join(runDirectory.directory, 'response.txt'), raw, { mode: 0o600 })
      } catch (error) {
        transportError = error
      } finally {
        runDirectory.remove()
      }
      if (transportError) {
        const failure = failureCode(transportError)
        const receipt = receiptFor(failure.code, responseSha256, [])
        persistReceipt(receipt)
        return fail(failure.code, failure.message, { ...context, receipt })
      }

      const blockedBeforeProposals = (
        outcome: 'transcript' | 'cursor' | 'lost',
      ): DreamLlmRunResult => {
        if (outcome === 'lost') {
          const receipt = receiptFor('RESERVATION_LOST', responseSha256, [])
          persistReceipt(receipt)
          return llmResult(
            'skipped',
            'RESERVATION_LOST',
            'The reflection reservation changed and was left in place.',
            { ...context, receipt },
          )
        }
        const code = outcome === 'cursor' ? 'CURSOR_MOVED' : 'TRANSCRIPT_PREFIX_CHANGED'
        const receipt = receiptFor(code, responseSha256, [])
        persistReceipt(receipt)
        return fail(
          code,
          outcome === 'cursor'
            ? 'The reflection cursor moved and was not rewound.'
            : 'Captured transcript evidence changed and was not accepted.',
          { ...context, receipt, proposalIds: [] },
        )
      }

      let plan: ReturnType<typeof planReflectionOperations>
      try {
        plan = planReflectionOperations(
          parseReflectionResponse(raw, { maxOperations: reflection.maxOperations }),
          snapshot,
          freshCandidate.projectSlug,
        )
      } catch (error) {
        const failure = failureCode(error)
        const receipt = receiptFor(failure.code, responseSha256, [])
        persistReceipt(receipt)
        return fail(failure.code, failure.message, { ...context, receipt })
      }

      const curationRequired = plan.operations
        .filter((operation) => operation.classification === DELETE_CLASSIFICATION)
        .map((operation) => ({ path: operation.path, description: operation.description }))
      const writes = plan.operations.flatMap((operation) =>
        operation.op === 'write'
          ? [
              {
                targetRelPath: operation.path,
                newContent: operation.body,
                reason: operation.description,
                author: DREAM_REFLECTION_AUTHOR,
              },
            ]
          : [],
      )

      const finalized = withDreamStateLock('dream reflection finalize', (): DreamLlmRunResult => {
        if (!owned || !ownsReservation(owned)) return blockedBeforeProposals('lost')
        if (getMemoryHeadRevision(memoryRoot) !== head) {
          const receipt = receiptFor('HEAD_RACE', responseSha256, [])
          persistReceipt(receipt)
          return fail(
            'HEAD_RACE',
            'MemFS HEAD changed after the reflection snapshot was captured.',
            {
              ...context,
              receipt,
            },
          )
        }
        const beforeWrites = verifyBoundSlice(bound)
        if (beforeWrites !== 'ok') return blockedBeforeProposals(beforeWrites)
        if (prefix.capturedThroughStep < startCursor) {
          const receipt = receiptFor('CURSOR_MOVED', responseSha256, [])
          persistReceipt(receipt)
          return llmResult(
            'failed',
            'CURSOR_MOVED',
            'The reflection cursor moved and was not rewound.',
            {
              ...context,
              receipt,
              proposalIds: [],
              curationRequired,
            },
          )
        }

        let proposalIds: string[] = []
        try {
          const created = createExplicitProposalSet(writes, {
            expectedHead: head,
            beforePersist: options.beforePersistProposal
              ? (_proposal, index) => {
                  options.beforePersistProposal?.(index)
                }
              : undefined,
          })
          proposalIds = created.proposalIds
          if (!ownsReservation(owned)) {
            discardExplicitProposals(proposalIds)
            return blockedBeforeProposals('lost')
          }
          if (getMemoryHeadRevision(memoryRoot) !== head) {
            discardExplicitProposals(proposalIds)
            const receipt = receiptFor('HEAD_RACE', responseSha256, [])
            persistReceipt(receipt)
            return fail(
              'HEAD_RACE',
              'MemFS HEAD changed after the reflection snapshot was captured.',
              { ...context, receipt, proposalIds: [], curationRequired },
            )
          }
          const raced = verifyBoundSlice(bound)
          if (raced !== 'ok') {
            discardExplicitProposals(proposalIds)
            return blockedBeforeProposals(raced)
          }
          const advanced = applyOwnedReflectionPatch({
            conversationId: freshCandidate.id,
            expectedCursor: startCursor,
            barrier: options.beforeOwnedReflectionWrite,
            apply: (state) => {
              state.reflection.reflectedThroughStep[freshCandidate.id] = prefix.capturedThroughStep
              state.reflection.lastRunByConversation[freshCandidate.id] = new Date(
                nowMs,
              ).toISOString()
              delete state.reflection.failures[freshCandidate.id]
            },
          })
          if (advanced.status !== 'applied') {
            discardExplicitProposals(proposalIds)
            const code = advanced.status === 'config-unchanged' ? 'CONFIG_INVALID' : 'CURSOR_MOVED'
            const receipt = receiptFor(code, responseSha256, [])
            persistReceipt(receipt)
            return llmResult(
              'failed',
              code,
              code === 'CURSOR_MOVED'
                ? 'The reflection cursor moved and was not rewound.'
                : 'Reflection config changed during finalization and was left unchanged.',
              { ...context, receipt, proposalIds: [], curationRequired },
            )
          }
          const createdProposals = proposalIds.length > 0
          const outcome = createdProposals ? 'ADVANCED' : 'NO_OP'
          const receipt = receiptFor(outcome, responseSha256, proposalIds)
          try {
            persistReceipt(receipt)
          } catch (error) {
            retainReservation = true
            return llmResult(
              'advanced',
              'ADVANCED_RECEIPT_FAILED',
              `The cursor and ${createdProposals ? 'proposals were' : 'no-op result was'} finalized, but the durable receipt failed: ${readError(error)}. The reservation remains for inspect or recovery.`,
              { ...context, proposalIds, curationRequired, receipt },
            )
          }
          return llmResult(
            'advanced',
            outcome,
            createdProposals
              ? `Created ${proposalIds.length} explicit memory proposal(s).`
              : 'Reviewed slice contained no supported memory write.',
            { ...context, proposalIds, curationRequired, receipt },
          )
        } catch (error) {
          if (proposalIds.length > 0) discardExplicitProposals(proposalIds)
          const failure = failureCode(error)
          const receipt = receiptFor(failure.code, responseSha256, [])
          persistReceipt(receipt)
          return fail(failure.code, failure.message, { ...context, curationRequired, receipt })
        }
      })
      if (finalized === 'lock-contention') {
        const receipt = receiptFor('LOCK_CONTENTION', responseSha256, [])
        persistReceipt(receipt)
        retainReservation = true
        return llmResult(
          'failed',
          'LOCK_CONTENTION',
          'Writer lock contention blocked reflection finalization. Transport was not called again. The reservation remains for inspect or recovery.',
          { ...context, receipt },
        )
      }
      return finalized
    })()
  } catch (error) {
    if (owned && !retainReservation) {
      try {
        const cleanup = releaseOwnedReservation()
        if (cleanup.status !== 'released' && cleanup.status !== 'absent') {
          throw new Error(`reservation cleanup returned ${cleanup.status}`)
        }
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Dream reflection failed and its reservation cleanup also failed.',
        )
      }
    }
    throw error
  }
  if (!owned || retainReservation || result.code === 'RESERVATION_LOST') return result
  let cleanup: ReturnType<typeof releaseReflectionReservation>
  try {
    cleanup = releaseOwnedReservation()
  } catch (error) {
    return {
      ...result,
      code: 'RESERVATION_RELEASE_FAILED',
      message: `${result.message} Reservation cleanup failed: ${readError(error)}. The reservation may remain and must be inspected before another provider run.`,
    }
  }
  if (cleanup.status === 'released') return result
  return {
    ...result,
    code: 'RESERVATION_RELEASE_FAILED',
    message: `${result.message} Reservation cleanup returned ${cleanup.status}; inspect the reservation before another provider run.`,
  }
}

export function runDream(scope: DreamCliScope, options: DreamRunOptions = {}): DreamDispatch {
  if (options.llm === true) return { mode: 'llm', result: runLlmReflection(scope, options) }
  if (scope.kind === 'all-projects') {
    return { mode: 'regex', report: runCrossProjectDream(scanAllPendingConversations(options)) }
  }
  if (scope.kind === 'project')
    return { mode: 'regex', report: runProjectDream(scope.slug, options) }
  return { mode: 'regex', report: runAutoDream(getProjectSlug(options.workspaceDir), options) }
}

const printScopedStatus = (scope: DreamCliScope): void => {
  if (scope.kind === 'all-projects') printAllProjectsStatus()
  else if (scope.kind === 'project') printStatus(scope.slug)
  else printStatus()
}

export type DreamCliPlan =
  | { kind: 'refuse'; message: string }
  | { kind: 'status'; scope: DreamCliScope }
  | { kind: 'auto-check' }
  | { kind: 'regex-run'; scope: DreamCliScope; force: boolean }
  | { kind: 'manual-llm-run'; scope: DreamCliScope; force: boolean }
  | { kind: 'scheduled-llm-run'; scope: DreamCliScope }
  | { kind: 'regex-cron-install' }
  | { kind: 'regex-cron-uninstall' }
  | { kind: 'llm-cron-preview' }
  | { kind: 'llm-cron-install'; confirmation: string | null }
  | { kind: 'inspect-reservation' }
  | { kind: 'reclaim-reservation'; token: string | null }

export type DreamMaintenancePlan = Extract<
  DreamCliPlan,
  | { kind: 'regex-cron-install' }
  | { kind: 'regex-cron-uninstall' }
  | { kind: 'llm-cron-preview' }
  | { kind: 'llm-cron-install' }
  | { kind: 'inspect-reservation' }
  | { kind: 'reclaim-reservation' }
>

const DREAM_COMMANDS = new Set([
  '--status',
  'status',
  '--auto-check',
  'auto-check',
  '--run-now',
  'run',
  '--run',
  '--run-scheduled-llm',
  '--install-cron',
  '--uninstall-cron',
  '--preview-llm-cron',
  '--install-llm-cron',
  '--inspect-reflection-reservation',
  '--reclaim-reflection-reservation',
])

const allowedDreamFlags = (command: string): Set<string> => {
  if (command === '--status' || command === 'status')
    return new Set(['--all-projects', '--project'])
  if (command === '--run-now' || command === 'run' || command === '--run') {
    return new Set(['--all-projects', '--project', '--force', '--llm'])
  }
  if (command === '--run-scheduled-llm') return new Set(['--all-projects', '--project'])
  if (command === '--install-llm-cron') return new Set(['--confirm-llm-cron'])
  if (command === '--reclaim-reflection-reservation') return new Set(['--reservation-token'])
  return new Set()
}

const refuseDream = (message: string): DreamCliPlan => ({ kind: 'refuse', message })

export function planDreamCli(args: string[]): DreamCliPlan {
  if (args.length === 0) return { kind: 'status', scope: { kind: 'current' } }
  const command = args[0] ?? '--status'
  const runCommand = command === '--run-now' || command === 'run' || command === '--run'
  if (args.includes('--llm') && !runCommand) {
    return refuseDream(
      '--llm is explicit and only runs with --run-now. Regex Dream was not started.',
    )
  }
  if (!DREAM_COMMANDS.has(command)) return refuseDream(`Unknown Dream command "${command}".`)
  const allowed = allowedDreamFlags(command)
  const seen = new Set<string>()
  const scopeArgs: string[] = []
  let force = false
  let confirmation: string | null = null
  let token: string | null = null
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    let name = arg
    if (arg.startsWith('--confirm-llm-cron=')) name = '--confirm-llm-cron'
    else if (arg.startsWith('--reservation-token=')) name = '--reservation-token'
    if (!allowed.has(name)) return refuseDream(`Unexpected Dream argument "${arg}".`)
    if (seen.has(name)) return refuseDream(`Unexpected duplicate Dream argument "${name}".`)
    seen.add(name)
    if (name === '--project') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) return refuseDream('--project requires a project slug.')
      scopeArgs.push('--project', value)
      index += 1
      continue
    }
    if (name === '--all-projects') scopeArgs.push('--all-projects')
    if (name === '--force') force = true
    if (name === '--confirm-llm-cron') confirmation = arg.slice('--confirm-llm-cron='.length)
    if (name === '--reservation-token') token = arg.slice('--reservation-token='.length)
  }
  let scope: DreamCliScope
  try {
    scope = parseDreamCliScope(scopeArgs)
  } catch (error) {
    return refuseDream(error instanceof Error ? error.message : String(error))
  }
  if (command === '--status' || command === 'status') return { kind: 'status', scope }
  if (command === '--auto-check' || command === 'auto-check') return { kind: 'auto-check' }
  if (runCommand && args.includes('--llm')) return { kind: 'manual-llm-run', scope, force }
  if (runCommand) return { kind: 'regex-run', scope, force }
  if (command === '--run-scheduled-llm') return { kind: 'scheduled-llm-run', scope }
  if (command === '--install-cron') return { kind: 'regex-cron-install' }
  if (command === '--uninstall-cron') return { kind: 'regex-cron-uninstall' }
  if (command === '--preview-llm-cron') return { kind: 'llm-cron-preview' }
  if (command === '--install-llm-cron') return { kind: 'llm-cron-install', confirmation }
  if (command === '--inspect-reflection-reservation') return { kind: 'inspect-reservation' }
  return { kind: 'reclaim-reservation', token }
}

export function runScheduledReflection(
  scope: DreamCliScope,
  options: DreamRunOptions = {},
): DreamDispatch {
  const loaded = readDreamStateFile()
  if (
    loaded.kind === 'reflection-invalid' ||
    loaded.kind === 'revision-invalid' ||
    loaded.kind === 'corrupt'
  ) {
    return { mode: 'llm', result: llmResult('failed', 'CONFIG_INVALID', loaded.error) }
  }
  if (!getDreamState().reflection.enabled) {
    return {
      mode: 'llm',
      result: llmResult(
        'skipped',
        'SKIPPED_DISABLED',
        'Automatic/scheduled LLM reflection is off. Manual --run-now --llm remains the operator override.',
      ),
    }
  }
  return runDream(scope, { ...options, llm: true, force: false })
}

let liveCronInvocations = 0

export const liveCronInvocationCount = (): number => liveCronInvocations

const execOutputText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value instanceof Buffer) return value.toString('utf8')
  return ''
}

export const interpretCrontabListFailure = (error: unknown): 'absent' | 'failed' => {
  const execError = error as NodeJS.ErrnoException & {
    status?: number | null
    stderr?: unknown
    stdout?: unknown
  }
  const text = `${execOutputText(execError.stderr)}\n${execOutputText(execError.stdout)}\n${execError.message ?? ''}`
  if (
    execError.code === 'ENOENT' ||
    execError.code === 'EACCES' ||
    execError.code === 'EPERM' ||
    /permission denied|operation not permitted/i.test(text)
  ) {
    return 'failed'
  }
  if (execError.status === 1 && /no crontab for\s+\S+/i.test(text)) return 'absent'
  return 'failed'
}

const createLiveCronExecutor = (): CronExecutor => ({
  read: () => {
    liveCronInvocations += 1
    try {
      return execFileSync('crontab', ['-l'], { encoding: 'utf8' })
    } catch (error) {
      if (interpretCrontabListFailure(error) === 'absent') return ''
      throw error
    }
  },
  write: (crontab: string) => {
    liveCronInvocations += 1
    execFileSync('crontab', ['-'], { input: crontab, encoding: 'utf8' })
  },
})

export const runDreamMaintenanceCommand = (
  plan: DreamMaintenancePlan,
  dependencies: {
    cron: CronExecutor
    nodePath: string
    scriptPath: string
    log?: (line: string) => void
    error?: (line: string) => void
  },
): number => {
  const log = dependencies.log ?? ((line: string) => console.log(line))
  const error = dependencies.error ?? ((line: string) => console.error(line))
  const paths = { nodePath: dependencies.nodePath, scriptPath: dependencies.scriptPath }
  if (plan.kind === 'llm-cron-preview') {
    const preview = previewLlmReflectionCron(paths)
    log(preview.line)
    log('LLM cron preview does not mutate crontab. No schedule is installed.')
    return 0
  }
  if (plan.kind === 'llm-cron-install') {
    const read = readDreamStateFile()
    if (
      read.kind === 'corrupt' ||
      read.kind === 'reflection-invalid' ||
      read.kind === 'revision-invalid'
    ) {
      error(`❌ LLM cron install refused: ${read.error}`)
      return 1
    }
    const result = installLlmReflectionCron({
      enabled: getDreamState().reflection.enabled,
      confirmation: plan.confirmation ?? undefined,
      executor: dependencies.cron,
      ...paths,
    })
    if (result.status !== 'installed') {
      error(`❌ LLM cron install refused (${result.code}).`)
      return 1
    }
    log(
      '✓ LLM reflection cron entry installed. It is eligible at the next scheduled time while reflection.enabled is on.',
    )
    return 0
  }
  if (plan.kind === 'regex-cron-install') {
    const result = installRegexDreamCron(dependencies.cron, paths.nodePath, paths.scriptPath)
    if (result.status === 'refused') {
      error(
        '❌ Regex cron install refused because crontab could not be read. No crontab write was attempted.',
      )
      return 1
    }
    log(
      result.status === 'installed'
        ? '✓ Auto-Dream cron job installed successfully (runs every 2 hours)!'
        : '✓ Auto-Dream cron job is already installed.',
    )
    return 0
  }
  if (plan.kind === 'regex-cron-uninstall') {
    try {
      uninstallRegexDreamCron(dependencies.cron)
    } catch (uninstallError) {
      if (uninstallError instanceof Error && uninstallError.message === 'CRON_READ_FAILED') {
        error(
          '❌ Regex cron uninstall refused because crontab could not be read. No crontab write was attempted.',
        )
        return 1
      }
      throw uninstallError
    }
    log('✓ Auto-Dream regex cron job removed. LLM cron lines were left in place.')
    return 0
  }
  if (plan.kind === 'inspect-reservation') {
    log(JSON.stringify(inspectReflectionReservation(memoryStateRoot), null, 2))
    return 0
  }
  if (!plan.token) {
    error('❌ Reclaim requires --reservation-token and evidence that the owner PID is dead.')
    return 1
  }
  const reclaimed = reclaimDeadReflectionReservation(memoryStateRoot, plan.token)
  log(JSON.stringify(reclaimed))
  return reclaimed.status === 'reclaimed' ? 0 : 1
}

const isMaintenancePlan = (plan: DreamCliPlan): plan is DreamMaintenancePlan =>
  plan.kind === 'regex-cron-install' ||
  plan.kind === 'regex-cron-uninstall' ||
  plan.kind === 'llm-cron-preview' ||
  plan.kind === 'llm-cron-install' ||
  plan.kind === 'inspect-reservation' ||
  plan.kind === 'reclaim-reservation'

if (process.argv[1]?.endsWith('dream-daemon.ts')) {
  const plan = planDreamCli(process.argv.slice(2))
  if (plan.kind === 'refuse') {
    console.error(`❌ ${plan.message}`)
    process.exit(1)
  }
  if (isMaintenancePlan(plan)) {
    process.exitCode = runDreamMaintenanceCommand(plan, {
      cron: createLiveCronExecutor(),
      nodePath: process.execPath,
      scriptPath: path.resolve(import.meta.filename),
    })
  } else if (plan.kind === 'status') {
    printScopedStatus(plan.scope)
  } else if (plan.kind === 'auto-check') {
    checkAndAutoDreamOnStepCount()
  } else if (plan.kind === 'manual-llm-run') {
    const reflection = getDreamState().reflection
    const result = runLlmReflection(plan.scope, {
      force: plan.force,
      idleMinutes: 0,
      transport: createAgyReflectionTransport({
        model: reflection.model,
        fallbackModel: reflection.fallbackModel,
        maxOperations: reflection.maxOperations,
      }),
    })
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = dreamLlmExitCode(result)
  } else if (plan.kind === 'scheduled-llm-run') {
    const reflection = getDreamState().reflection
    const dispatch = runScheduledReflection(plan.scope, {
      idleMinutes: 0,
      transport: createAgyReflectionTransport({
        model: reflection.model,
        fallbackModel: reflection.fallbackModel,
        maxOperations: reflection.maxOperations,
      }),
    })
    if (dispatch.mode === 'llm') {
      console.log(JSON.stringify(dispatch.result, null, 2))
      process.exitCode = dreamLlmExitCode(dispatch.result)
    }
  } else {
    const options: ScanOptions = { force: plan.force, idleMinutes: 0 }
    if (plan.scope.kind === 'all-projects')
      runCrossProjectDream(scanAllPendingConversations(options))
    else if (plan.scope.kind === 'project') runProjectDream(plan.scope.slug, options)
    else runAutoDream(getProjectSlug(), options)
  }
}
