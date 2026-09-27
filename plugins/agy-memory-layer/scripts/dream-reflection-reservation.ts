/**
 * One active Dream v2 reflection reservation.
 *
 * Version-1 JSON stays the on-disk record. Acquire, token-and-PID release, and
 * token-plus-proven-dead reclaim take the same external writer lock as Dream
 * state writers, and only for that short mutation. Inspection does not take
 * the lock and does not delete anything. A live, dead, malformed, or
 * unreadable record is never removed automatically. Unexpected liveness probe
 * errors stay ambiguous; only ESRCH is proven dead. Mixed old and new process
 * writers are unsupported and this module does not migrate or delete an
 * existing v1 file on their behalf. A leftover reservation after a crash is
 * not replay.
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  acquireMemoryWriteLockAtStateRoot,
  type MemoryWriteLock,
  MemoryWriteLockError,
  releaseMemoryWriteLock,
} from './memory-write-lock.ts'
import { classifyProcessLiveness, type ProcessLiveness } from './process-liveness.ts'

export const REFLECTION_RESERVATION_VERSION = 1
export const REFLECTION_RESERVATION_FILE = 'reflection-reservation.json'

const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const RESERVATION_FIELDS = ['version', 'token', 'pid', 'createdAt', 'conversationId'] as const

export type ReflectionReservation = {
  version: typeof REFLECTION_RESERVATION_VERSION
  token: string
  pid: number
  createdAt: string
  conversationId: string
}

export type ProcessLivenessProbe = (pid: number) => boolean

export type ReflectionReservationAmbiguousReason =
  | 'invalid-json'
  | 'schema'
  | 'unreadable'
  | 'not-a-file'
  | 'liveness'

export type ReflectionReservationInspection =
  | { status: 'absent' }
  | { status: 'live'; reservation: ReflectionReservation }
  | { status: 'dead'; reservation: ReflectionReservation }
  | { status: 'ambiguous'; reason: ReflectionReservationAmbiguousReason }

export type ReflectionReservationAcquire =
  | { status: 'acquired'; reservation: ReflectionReservation }
  | { status: 'live'; reservation: ReflectionReservation }
  | { status: 'dead'; reservation: ReflectionReservation }
  | { status: 'ambiguous'; reason: ReflectionReservationAmbiguousReason }
  | { status: 'refused'; reason: 'invalid-conversation-id' }
  | { status: 'lock-contention' }

export type ReflectionReservationRelease =
  | { status: 'released' }
  | { status: 'mismatch' }
  | { status: 'absent' }
  | { status: 'lock-contention' }
  | { status: 'ambiguous'; reason: ReflectionReservationAmbiguousReason }

export type ReflectionReservationReclaim =
  | { status: 'reclaimed' }
  | { status: 'live' }
  | { status: 'mismatch' }
  | { status: 'absent' }
  | { status: 'lock-contention' }
  | { status: 'ambiguous'; reason: ReflectionReservationAmbiguousReason }

export type ReflectionReservationOptions = {
  isAlive?: ProcessLivenessProbe
  liveness?: (pid: number) => ProcessLiveness
  pid?: number
  now?: () => string
  beforeReservationUnlink?: () => void
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const reflectionReservationPath = (stateRoot: string): string =>
  path.join(stateRoot, REFLECTION_RESERVATION_FILE)

const ambiguousRead = (
  reason: ReflectionReservationAmbiguousReason,
): { status: 'ambiguous'; reason: ReflectionReservationAmbiguousReason } => ({
  status: 'ambiguous',
  reason,
})

const ambiguousInspection = (
  value: ReflectionReservationInspection,
): { status: 'ambiguous'; reason: ReflectionReservationAmbiguousReason } =>
  value.status === 'ambiguous' ? value : ambiguousRead('unreadable')

const parseReservation = (raw: string): ReflectionReservation | 'invalid-json' | 'schema' => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'invalid-json'
  }
  if (!isRecord(parsed)) return 'schema'
  const keys = Object.keys(parsed)
  if (
    keys.length !== RESERVATION_FIELDS.length ||
    RESERVATION_FIELDS.some((key) => !(key in parsed))
  ) {
    return 'schema'
  }
  if (parsed.version !== REFLECTION_RESERVATION_VERSION) return 'schema'
  if (typeof parsed.token !== 'string' || !TOKEN_PATTERN.test(parsed.token)) return 'schema'
  if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0)
    return 'schema'
  if (typeof parsed.createdAt !== 'string' || !UTC_TIMESTAMP_PATTERN.test(parsed.createdAt)) {
    return 'schema'
  }
  if (new Date(parsed.createdAt).toISOString() !== parsed.createdAt) return 'schema'
  if (
    typeof parsed.conversationId !== 'string' ||
    !CONVERSATION_ID_PATTERN.test(parsed.conversationId)
  ) {
    return 'schema'
  }
  return {
    version: REFLECTION_RESERVATION_VERSION,
    token: parsed.token,
    pid: parsed.pid,
    createdAt: parsed.createdAt,
    conversationId: parsed.conversationId,
  }
}

const readReservation = (stateRoot: string): ReflectionReservationInspection => {
  const reservationPath = reflectionReservationPath(stateRoot)
  let stat: fs.Stats
  try {
    stat = fs.statSync(reservationPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { status: 'absent' }
    return ambiguousRead('unreadable')
  }
  if (!stat.isFile()) return ambiguousRead('not-a-file')
  let raw = ''
  try {
    raw = fs.readFileSync(reservationPath, 'utf8')
  } catch {
    return ambiguousRead('unreadable')
  }
  const parsed = parseReservation(raw)
  if (parsed === 'invalid-json' || parsed === 'schema') return ambiguousRead(parsed)
  return { status: 'live', reservation: parsed }
}

const classifyPid = (pid: number, options: ReflectionReservationOptions): ProcessLiveness => {
  try {
    if (options.liveness) {
      const value = options.liveness(pid)
      if (value === 'live' || value === 'dead' || value === 'ambiguous') return value
      return 'ambiguous'
    }
    if (options.isAlive) return options.isAlive(pid) ? 'live' : 'dead'
    return classifyProcessLiveness(pid)
  } catch {
    return 'ambiguous'
  }
}

const classify = (
  read: ReflectionReservationInspection,
  options: ReflectionReservationOptions,
): ReflectionReservationInspection => {
  if (read.status !== 'live') return read
  const liveness = classifyPid(read.reservation.pid, options)
  if (liveness === 'live') return read
  if (liveness === 'dead') return { status: 'dead', reservation: read.reservation }
  return ambiguousRead('liveness')
}

export const inspectReflectionReservation = (
  stateRoot: string,
  options: ReflectionReservationOptions = {},
): ReflectionReservationInspection => classify(readReservation(stateRoot), options)

const withReservationMutation = <T>(
  stateRoot: string,
  operation: string,
  body: () => T,
): T | { status: 'lock-contention' } => {
  let lock: MemoryWriteLock
  try {
    lock = acquireMemoryWriteLockAtStateRoot(stateRoot, operation)
  } catch (error) {
    if (error instanceof MemoryWriteLockError) return { status: 'lock-contention' }
    throw error
  }
  try {
    return body()
  } finally {
    releaseMemoryWriteLock(lock)
  }
}

const unlinkMatchingReservation = (
  stateRoot: string,
  expected: ReflectionReservation,
  options: ReflectionReservationOptions,
): 'removed' | 'mismatch' | 'absent' | ReflectionReservationInspection => {
  options.beforeReservationUnlink?.()
  const again = readReservation(stateRoot)
  if (again.status === 'absent') return 'absent'
  if (again.status !== 'live') return again
  if (again.reservation.token !== expected.token || again.reservation.pid !== expected.pid) {
    return 'mismatch'
  }
  fs.unlinkSync(reflectionReservationPath(stateRoot))
  return 'removed'
}

const writeNewReservation = (stateRoot: string, reservation: ReflectionReservation): void => {
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    reflectionReservationPath(stateRoot),
    `${JSON.stringify(reservation, null, 2)}\n`,
    {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    },
  )
}

export const acquireReflectionReservation = (
  stateRoot: string,
  conversationId: string,
  options: ReflectionReservationOptions = {},
): ReflectionReservationAcquire => {
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
    return { status: 'refused', reason: 'invalid-conversation-id' }
  }
  return withReservationMutation(stateRoot, 'acquire reflection reservation', () => {
    const existing = classify(readReservation(stateRoot), options)
    if (existing.status === 'ambiguous') return existing
    if (existing.status === 'live' || existing.status === 'dead') return existing
    const reservation: ReflectionReservation = {
      version: REFLECTION_RESERVATION_VERSION,
      token: crypto.randomUUID(),
      pid: options.pid ?? process.pid,
      createdAt: options.now?.() ?? new Date().toISOString(),
      conversationId,
    }
    try {
      writeNewReservation(stateRoot, reservation)
      return { status: 'acquired' as const, reservation }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'EISDIR') throw error
    }
    const raced = classify(readReservation(stateRoot), options)
    if (raced.status === 'absent')
      return { status: 'ambiguous' as const, reason: 'unreadable' as const }
    return raced
  })
}

export const releaseReflectionReservation = (
  stateRoot: string,
  token: string,
  options: ReflectionReservationOptions = {},
): ReflectionReservationRelease =>
  withReservationMutation(
    stateRoot,
    'release reflection reservation',
    (): ReflectionReservationRelease => {
      const read = readReservation(stateRoot)
      if (read.status === 'absent') return { status: 'absent' as const }
      if (read.status !== 'live') return ambiguousInspection(read)
      const pid = options.pid ?? process.pid
      if (read.reservation.token !== token || read.reservation.pid !== pid) {
        return { status: 'mismatch' as const }
      }
      const removed = unlinkMatchingReservation(stateRoot, read.reservation, options)
      if (removed === 'removed') return { status: 'released' as const }
      if (removed === 'mismatch') return { status: 'mismatch' as const }
      if (removed === 'absent') return { status: 'absent' as const }
      return ambiguousInspection(removed)
    },
  )

export const reclaimDeadReflectionReservation = (
  stateRoot: string,
  token: string,
  options: ReflectionReservationOptions = {},
): ReflectionReservationReclaim =>
  withReservationMutation(
    stateRoot,
    'reclaim reflection reservation',
    (): ReflectionReservationReclaim => {
      const read = readReservation(stateRoot)
      if (read.status === 'absent') return { status: 'absent' as const }
      if (read.status !== 'live') return ambiguousInspection(read)
      if (read.reservation.token !== token) return { status: 'mismatch' as const }
      const liveness = classifyPid(read.reservation.pid, options)
      if (liveness === 'ambiguous') return ambiguousRead('liveness')
      if (liveness === 'live') return { status: 'live' as const }
      const removed = unlinkMatchingReservation(stateRoot, read.reservation, options)
      if (removed === 'removed') return { status: 'reclaimed' as const }
      if (removed === 'mismatch') return { status: 'mismatch' as const }
      if (removed === 'absent') return { status: 'absent' as const }
      return ambiguousInspection(removed)
    },
  )
