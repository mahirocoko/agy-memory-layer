#!/usr/bin/env node

/**
 * Stop hook for agy-memory-layer.
 *
 * Stop is an observation boundary, not a memory-approval boundary. It never
 * stages, commits, deletes Git locks, or launches background reflection work.
 * When reflection policy is explicitly set to 'step-count', it updates the
 * external step counter under memory.state/reflection-steps.json only.
 */

import * as os from 'node:os'
import * as path from 'node:path'
import { isDirectCliInvocation } from './cli-entrypoint.ts'
import { getMemoryRepositoryStatus } from './memory-repository.ts'
import { recordAssistantStep } from './reflection-policy.ts'
import { resolveProjectSlug } from './workspace-identity.ts'

export type StopOutput = {
  decision: 'stop'
}

export type StopPayload = {
  workspacePaths?: string[]
  cwd?: string
  conversationId?: string
  terminationReason?: string
}

export function runStopHook(
  memoryRoot: string = process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory'),
  inputJson?: string,
): StopOutput {
  const status = getMemoryRepositoryStatus(memoryRoot)

  if (status.state !== 'clean') {
    const paths = status.changedPaths.slice(0, 8).join(', ')
    const suffix = paths ? ` Changed paths: ${paths}.` : ''
    console.error(
      `agy-memory-layer: ${status.summary}${suffix} Stop did not modify the repository.`,
    )
  }

  if (inputJson?.trim()) {
    try {
      const parsed: unknown = JSON.parse(inputJson)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const payload = parsed as StopPayload
        const isNormalTurnEnd =
          payload.terminationReason === undefined ||
          payload.terminationReason === '' ||
          payload.terminationReason === 'NO_TOOL_CALL'
        const workspace =
          (Array.isArray(payload.workspacePaths) &&
            typeof payload.workspacePaths[0] === 'string' &&
            payload.workspacePaths[0]) ||
          (typeof payload.cwd === 'string' && payload.cwd) ||
          ''
        if (isNormalTurnEnd && workspace) {
          const projectSlug = resolveProjectSlug(workspace, memoryRoot)
          recordAssistantStep(
            memoryRoot,
            projectSlug,
            typeof payload.conversationId === 'string' ? payload.conversationId : undefined,
          )
        }
      }
    } catch {
      // Stop hook must stay observational and never fail on malformed payload
    }
  }

  return { decision: 'stop' }
}

if (isDirectCliInvocation(import.meta.url)) {
  let stdinData = ''
  process.stdin.setEncoding('utf-8')
  process.stdin.on('data', (chunk) => {
    stdinData += chunk
  })
  process.stdin.on('end', () => {
    process.stdout.write(JSON.stringify(runStopHook(undefined, stdinData)))
  })
}
