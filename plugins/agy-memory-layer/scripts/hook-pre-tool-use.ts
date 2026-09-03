#!/usr/bin/env node

/**
 * PreToolUse Hook for agy-memory-layer
 * Evaluates tool calls before execution to enforce Git safety, dependency gates,
 * file containment, and subagent capability boundaries.
 */

import { isDirectCliInvocation } from './cli-entrypoint.ts'
import { evaluatePreToolUse, type PreToolUsePayload } from './tool-guard.ts'

export function runPreToolUseHook(payload: PreToolUsePayload) {
  return evaluatePreToolUse(payload)
}

if (isDirectCliInvocation(import.meta.url)) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    raw += chunk
  })
  process.stdin.on('end', () => {
    try {
      const payload: PreToolUsePayload = raw.trim() ? JSON.parse(raw) : { toolCall: { name: '' } }
      const result = runPreToolUseHook(payload)
      process.stdout.write(JSON.stringify(result))
    } catch (err) {
      process.stdout.write(
        JSON.stringify({
          decision: 'force_ask',
          reason: `Hook error fallback: ${err instanceof Error ? err.message : String(err)}`,
        }),
      )
    }
  })
}
