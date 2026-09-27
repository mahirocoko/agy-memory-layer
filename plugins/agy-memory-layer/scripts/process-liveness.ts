#!/usr/bin/env node

/**
 * Process Liveness and Orphan Detection Utilities for agy-memory-layer.
 * Prevents zombie background tasks, stale daemons, and hanging workers
 * when the parent CLI or terminal disconnects (inspired by Letta Code orphan detection).
 *
 * Strict engineering rules:
 * - TypeScript type alias ONLY (no interface).
 * - Zero external npm dependencies.
 */

export type OrphanDetectionOptions = {
  parentPid?: number
  intervalMs?: number
  onOrphan?: () => void
}

export type ProcessLivenessStatus = {
  pid: number
  alive: boolean
  isOrphan: boolean
}

export type ProcessLiveness = 'live' | 'dead' | 'ambiguous'

/**
 * Checks whether a given process ID is alive using signal 0.
 * Unexpected probe errors are reported as not alive. Reclaim paths that need
 * positive proof of death must use classifyProcessLiveness instead.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Distinguishes a live process, a proven-dead process (ESRCH), and an
 * unexpected probe failure. Only `dead` is positive evidence that the PID is gone.
 */
export const classifyProcessLiveness = (pid: number): ProcessLiveness => {
  if (!Number.isInteger(pid) || pid <= 0) return 'ambiguous'
  try {
    process.kill(pid, 0)
    return 'live'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM') return 'live'
    if (code === 'ESRCH') return 'dead'
    return 'ambiguous'
  }
}

/**
 * Checks whether the current process has become an orphan (reparented to PID 1 on Unix).
 */
export function isCurrentProcessOrphan(expectedParentPid?: number): boolean {
  if (process.platform === 'win32') return false
  if (process.ppid === 1 && expectedParentPid !== 1) return true
  if (expectedParentPid && expectedParentPid > 1 && !isProcessAlive(expectedParentPid)) {
    return true
  }
  return false
}

/**
 * Starts periodic orphan detection.
 * Automatically invokes onOrphan or terminates the process when reparented to PID 1
 * or when the expected parent process dies.
 */
export function startOrphanDetection(options: OrphanDetectionOptions = {}): NodeJS.Timeout {
  const targetParentPid = options.parentPid || process.ppid
  const interval = options.intervalMs || 3000

  const timer = setInterval(() => {
    if (isCurrentProcessOrphan(targetParentPid)) {
      if (options.onOrphan) {
        options.onOrphan()
      } else {
        process.exit(0)
      }
    }
  }, interval)

  if (typeof timer.unref === 'function') {
    timer.unref()
  }

  return timer
}
