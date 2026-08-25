#!/usr/bin/env node

/**
 * Stop hook for agy-memory-layer.
 *
 * Stop is an observation boundary, not a memory-approval boundary. It never
 * stages, commits, deletes Git locks, or launches background reflection work.
 */

import * as os from 'node:os'
import * as path from 'node:path'
import { isDirectCliInvocation } from './cli-entrypoint.ts'
import { getMemoryRepositoryStatus } from './memory-repository.ts'

export type StopOutput = {
  decision: 'stop'
}

export function runStopHook(
  memoryRoot: string = process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory'),
): StopOutput {
  const status = getMemoryRepositoryStatus(memoryRoot)

  if (status.state !== 'clean') {
    const paths = status.changedPaths.slice(0, 8).join(', ')
    const suffix = paths ? ` Changed paths: ${paths}.` : ''
    console.error(
      `agy-memory-layer: ${status.summary}${suffix} Stop did not modify the repository.`,
    )
  }

  return { decision: 'stop' }
}

if (isDirectCliInvocation(import.meta.url)) {
  process.stdin.resume()
  process.stdin.on('end', () => {
    process.stdout.write(JSON.stringify(runStopHook()))
  })
}
