#!/usr/bin/env node

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type MemoryWriteLock = {
  token: string
  operation: string
  lockPath: string
  createdAt: string
  pid: number
}

type LockOwner = {
  token: string
  operation: string
  createdAt: string
  pid: number
}

const getMemoryStateRoot = (memoryRoot: string): string =>
  process.env.AGY_MEMORY_STATE_DIR || `${path.resolve(memoryRoot)}.state`

const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const readLockOwner = (lockPath: string): LockOwner | null => {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as Partial<LockOwner>
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.operation !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.pid !== 'number'
    ) {
      return null
    }
    return parsed as LockOwner
  } catch {
    return null
  }
}

export const acquireMemoryWriteLock = (memoryRoot: string, operation: string): MemoryWriteLock => {
  const stateRoot = getMemoryStateRoot(memoryRoot)
  const locksRoot = path.join(stateRoot, 'locks')
  const lockPath = path.join(locksRoot, 'memory-write.lock')
  fs.mkdirSync(locksRoot, { recursive: true })

  const createLock = (): MemoryWriteLock => {
    const lock: MemoryWriteLock = {
      token: crypto.randomUUID(),
      operation,
      lockPath,
      createdAt: new Date().toISOString(),
      pid: process.pid,
    }
    fs.writeFileSync(
      lockPath,
      `${JSON.stringify(
        {
          token: lock.token,
          operation: lock.operation,
          createdAt: lock.createdAt,
          pid: lock.pid,
        } satisfies LockOwner,
        null,
        2,
      )}\n`,
      { encoding: 'utf-8', flag: 'wx', mode: 0o600 },
    )
    return lock
  }

  try {
    return createLock()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }

  const owner = readLockOwner(lockPath)
  if (owner && isProcessAlive(owner.pid)) {
    throw new Error(
      `Memory write lock is held by PID ${owner.pid} for ${owner.operation} since ${owner.createdAt}.`,
    )
  }
  throw new Error(
    owner
      ? `Stale memory write lock from PID ${owner.pid} for ${owner.operation}; remove ${lockPath} only after verifying no writer is active.`
      : `Unreadable memory write lock at ${lockPath}; remove it only after verifying no writer is active.`,
  )
}

export const releaseMemoryWriteLock = (lock: MemoryWriteLock): void => {
  const owner = readLockOwner(lock.lockPath)
  if (!owner || owner.token !== lock.token || owner.pid !== lock.pid) {
    throw new Error('Refusing to release a memory write lock owned by another process.')
  }
  fs.unlinkSync(lock.lockPath)
}

export const withMemoryWriteLock = <T>(
  memoryRoot: string,
  operation: string,
  callback: () => T,
): T => {
  const lock = acquireMemoryWriteLock(memoryRoot, operation)
  try {
    return callback()
  } finally {
    releaseMemoryWriteLock(lock)
  }
}

export const reclaimStaleMemoryWriteLock = (memoryRoot: string): boolean => {
  const stateRoot = getMemoryStateRoot(memoryRoot)
  const lockPath = path.join(stateRoot, 'locks', 'memory-write.lock')
  if (!fs.existsSync(lockPath)) return false
  const owner = readLockOwner(lockPath)
  if (!owner || !isProcessAlive(owner.pid)) {
    try {
      fs.unlinkSync(lockPath)
      return true
    } catch {
      return false
    }
  }
  return false
}
