#!/usr/bin/env node

/**
 * Reflection Policy & Step Counter Store (outside Git MemFS).
 * Mirrors mahiro-pi's selectable off / step-count reflection controls
 * while keeping Stop hook non-mutating to the Git MemFS repository.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { memoryStateRootFor } from './memory-write-lock.ts'

export type ReflectionTrigger = 'off' | 'step-count'

export type ReflectionPolicy = {
  version: 1
  trigger: ReflectionTrigger
  stepCountThreshold: number
  model: string
}

export type ProjectStepEntry = {
  projectSlug: string
  pendingSteps: number
  totalSteps: number
  pendingReflectionDue: boolean
  lastStepAt: string | null
  lastReflectedAt: string | null
  lastConversationId?: string
}

export type ReflectionStepsState = {
  version: 1
  projects: Record<string, ProjectStepEntry>
}

export const DEFAULT_REFLECTION_STEP_THRESHOLD = 25

export const DEFAULT_REFLECTION_POLICY: ReflectionPolicy = {
  version: 1,
  trigger: 'off',
  stepCountThreshold: DEFAULT_REFLECTION_STEP_THRESHOLD,
  model: 'inherit',
}

export function reflectionPolicyPath(memoryRoot: string): string {
  return path.join(memoryStateRootFor(memoryRoot), 'reflection-policy.json')
}

export function reflectionStepsPath(memoryRoot: string): string {
  return path.join(memoryStateRootFor(memoryRoot), 'reflection-steps.json')
}

function writePrivateJsonAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  })
  fs.renameSync(tempPath, filePath)
}

export function validateReflectionPolicy(candidate: unknown): ReflectionPolicy {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('Reflection policy must be an object.')
  }
  const raw = candidate as Record<string, unknown>
  const trigger = raw.trigger
  if (trigger !== 'off' && trigger !== 'step-count') {
    throw new Error('Reflection trigger must be "off" or "step-count".')
  }
  const threshold = raw.stepCountThreshold
  if (
    typeof threshold !== 'number' ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > 100_000
  ) {
    throw new Error('Reflection stepCountThreshold must be an integer between 1 and 100000.')
  }
  const model = raw.model === undefined ? 'inherit' : raw.model
  if (
    typeof model !== 'string' ||
    !model.trim() ||
    model.trim().startsWith('-') ||
    /\s/.test(model) ||
    [...model].some((ch) => {
      const code = ch.charCodeAt(0)
      return code < 0x20 || code === 0x7f
    })
  ) {
    throw new Error(
      'Reflection model must be "inherit" or a single non-empty model identifier without leading dashes.',
    )
  }
  return {
    version: 1,
    trigger,
    stepCountThreshold: threshold,
    model: model.trim(),
  }
}

export function getReflectionPolicy(memoryRoot: string): ReflectionPolicy {
  const filePath = reflectionPolicyPath(memoryRoot)
  if (!fs.existsSync(filePath)) return { ...DEFAULT_REFLECTION_POLICY }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return validateReflectionPolicy(parsed)
  } catch {
    return { ...DEFAULT_REFLECTION_POLICY }
  }
}

export function saveReflectionPolicy(
  memoryRoot: string,
  update: Partial<Pick<ReflectionPolicy, 'trigger' | 'stepCountThreshold' | 'model'>>,
): ReflectionPolicy {
  const current = getReflectionPolicy(memoryRoot)
  const merged = validateReflectionPolicy({
    version: 1,
    trigger: update.trigger ?? current.trigger,
    stepCountThreshold: update.stepCountThreshold ?? current.stepCountThreshold,
    model: update.model ?? current.model,
  })
  writePrivateJsonAtomic(reflectionPolicyPath(memoryRoot), merged)
  return merged
}

export function getReflectionStepState(memoryRoot: string): ReflectionStepsState {
  const filePath = reflectionStepsPath(memoryRoot)
  if (!fs.existsSync(filePath)) {
    return { version: 1, projects: {} }
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<ReflectionStepsState>
    if (
      parsed &&
      parsed.version === 1 &&
      parsed.projects &&
      typeof parsed.projects === 'object' &&
      !Array.isArray(parsed.projects)
    ) {
      return { version: 1, projects: { ...parsed.projects } }
    }
  } catch {
    // Fall back to empty state when corrupt/unreadable
  }
  return { version: 1, projects: {} }
}

export function getProjectReflectionStepEntry(
  memoryRoot: string,
  projectSlug: string,
): ProjectStepEntry {
  const state = getReflectionStepState(memoryRoot)
  return (
    state.projects[projectSlug] ?? {
      projectSlug,
      pendingSteps: 0,
      totalSteps: 0,
      pendingReflectionDue: false,
      lastStepAt: null,
      lastReflectedAt: null,
    }
  )
}

export function recordAssistantStep(
  memoryRoot: string,
  projectSlug: string,
  conversationId?: string,
): ProjectStepEntry | null {
  const policy = getReflectionPolicy(memoryRoot)
  if (policy.trigger !== 'step-count') return null

  const state = getReflectionStepState(memoryRoot)
  const existing = state.projects[projectSlug] ?? {
    projectSlug,
    pendingSteps: 0,
    totalSteps: 0,
    pendingReflectionDue: false,
    lastStepAt: null,
    lastReflectedAt: null,
  }
  const pendingSteps = existing.pendingSteps + 1
  const nextEntry: ProjectStepEntry = {
    projectSlug,
    pendingSteps,
    totalSteps: existing.totalSteps + 1,
    pendingReflectionDue: pendingSteps >= policy.stepCountThreshold,
    lastStepAt: new Date().toISOString(),
    lastReflectedAt: existing.lastReflectedAt,
    ...(conversationId?.trim()
      ? { lastConversationId: conversationId.trim() }
      : existing.lastConversationId
        ? { lastConversationId: existing.lastConversationId }
        : {}),
  }
  state.projects[projectSlug] = nextEntry
  writePrivateJsonAtomic(reflectionStepsPath(memoryRoot), state)
  return nextEntry
}

export function markProjectReflected(memoryRoot: string, projectSlug: string): ProjectStepEntry {
  const state = getReflectionStepState(memoryRoot)
  const existing = state.projects[projectSlug]
  const nextEntry: ProjectStepEntry = {
    projectSlug,
    pendingSteps: 0,
    totalSteps: existing?.totalSteps ?? 0,
    pendingReflectionDue: false,
    lastStepAt: existing?.lastStepAt ?? null,
    lastReflectedAt: new Date().toISOString(),
    ...(existing?.lastConversationId ? { lastConversationId: existing.lastConversationId } : {}),
  }
  state.projects[projectSlug] = nextEntry
  writePrivateJsonAtomic(reflectionStepsPath(memoryRoot), state)
  return nextEntry
}
