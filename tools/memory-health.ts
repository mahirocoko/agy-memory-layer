#!/usr/bin/env node --experimental-strip-types

import { execFileSync } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'
import { inspectCommittedWorkingHypothesis } from '../plugins/agy-memory-layer/scripts/active-learning.ts'
import { isDirectCliInvocation } from '../plugins/agy-memory-layer/scripts/cli-entrypoint.ts'
import {
  ACTIVE_MEMORY_BUDGET_TOKENS,
  generatePreInvocationContext,
} from '../plugins/agy-memory-layer/scripts/hook-inject-memory.ts'
import { inspectCommittedMemoryProjection } from '../plugins/agy-memory-layer/scripts/layered-memory.ts'
import { getMemoryRepositoryStatus } from '../plugins/agy-memory-layer/scripts/memory-repository.ts'
import { resolveProjectSlug } from '../plugins/agy-memory-layer/scripts/workspace-identity.ts'

export type WorkspaceHealth = {
  workspace: string
  projectSlug: string
  layoutMode: 'empty' | 'legacy' | 'layered' | 'conflict'
  estimatedTokens: number
  withinBudget: boolean
  hasProjectContext: boolean
  hasProjectRules: boolean
  injectsArchive: boolean
  injectsSessionBoilerplate: boolean
  workingHypothesisState: 'none' | 'selected' | 'conflict'
  workingHypothesisPath?: string
  workingHypothesisDiagnostics: string[]
}

export type MemoryHealthReport = {
  memoryRoot: string
  repositoryState: string
  budgetTokens: number
  trackedTransientPaths: string[]
  workspaces: WorkspaceHealth[]
  issues: string[]
  healthy: boolean
}

const listTrackedTransientPaths = (memoryRoot: string): string[] => {
  try {
    return execFileSync('git', ['ls-files', '-z'], {
      cwd: memoryRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter(Boolean)
      .filter((file) => file === '.dream_state.json' || file.endsWith('.tmp'))
      .sort()
  } catch {
    return []
  }
}

export const inspectMemoryHealth = (
  memoryRoot: string,
  workspacePaths: string[],
): MemoryHealthReport => {
  const repositoryStatus = getMemoryRepositoryStatus(memoryRoot)
  const trackedTransientPaths = listTrackedTransientPaths(memoryRoot)
  const workspaces = workspacePaths.map((workspace): WorkspaceHealth => {
    const projectSlug = resolveProjectSlug(workspace, memoryRoot)
    const output = generatePreInvocationContext(
      JSON.stringify({ workspacePaths: [workspace], conversationId: 'memory-health-check' }),
      memoryRoot,
    )
    const message = output.injectSteps[0]?.ephemeralMessage || ''
    const estimatedTokens = Math.ceil(message.length / 4)
    const workingHypothesis = inspectCommittedWorkingHypothesis(projectSlug, memoryRoot)
    const memoryProjection = inspectCommittedMemoryProjection(memoryRoot, projectSlug)

    return {
      workspace,
      projectSlug,
      layoutMode: memoryProjection.mode,
      estimatedTokens,
      withinBudget: estimatedTokens <= ACTIVE_MEMORY_BUDGET_TOKENS,
      hasProjectContext:
        memoryProjection.projectSystem.length > 0 &&
        (memoryProjection.mode === 'legacy'
          ? memoryProjection.projectSystem.some((document) =>
              document.relativePath.endsWith('/project.md'),
            )
          : true),
      hasProjectRules:
        memoryProjection.projectSystem.length > 0 &&
        (memoryProjection.mode === 'legacy'
          ? memoryProjection.projectSystem.some((document) =>
              document.relativePath.endsWith('/rules.md'),
            )
          : true),
      injectsArchive: message.includes('archive_'),
      injectsSessionBoilerplate:
        message.includes('Session Continuity') || message.includes('Autonomous Recall'),
      workingHypothesisState: workingHypothesis.state,
      workingHypothesisPath: workingHypothesis.selectedPath,
      workingHypothesisDiagnostics: workingHypothesis.diagnostics,
    }
  })

  const issues: string[] = []
  if (repositoryStatus.state !== 'clean') {
    issues.push(`MemFS repository is ${repositoryStatus.state}.`)
  }
  for (const transientPath of trackedTransientPaths) {
    issues.push(`Tracked transient path: ${transientPath}`)
  }
  for (const workspace of workspaces) {
    if (!workspace.hasProjectContext || !workspace.hasProjectRules) {
      issues.push(`Incomplete project scope: ${workspace.projectSlug}`)
    }
    if (!workspace.withinBudget) {
      issues.push(
        `Projection exceeds ${ACTIVE_MEMORY_BUDGET_TOKENS} tokens: ${workspace.projectSlug} (${workspace.estimatedTokens})`,
      )
    }
    if (workspace.injectsArchive || workspace.injectsSessionBoilerplate) {
      issues.push(`Low-signal learning injection: ${workspace.projectSlug}`)
    }
    for (const diagnostic of workspace.workingHypothesisDiagnostics) {
      issues.push(`Working hypothesis conflict (${workspace.projectSlug}): ${diagnostic}`)
    }
    const memoryProjection = inspectCommittedMemoryProjection(memoryRoot, workspace.projectSlug)
    for (const diagnostic of memoryProjection.diagnostics) {
      issues.push(`Layered memory (${workspace.projectSlug}): ${diagnostic}`)
    }
  }

  return {
    memoryRoot,
    repositoryState: repositoryStatus.state,
    budgetTokens: ACTIVE_MEMORY_BUDGET_TOKENS,
    trackedTransientPaths,
    workspaces,
    issues,
    healthy: issues.length === 0,
  }
}

const parseArgs = (
  args: string[],
): { memoryRoot: string; workspaces: string[]; strict: boolean } => {
  let memoryRoot = process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory')
  const workspaces: string[] = []
  let strict = false

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--memory' && args[index + 1]) {
      memoryRoot = path.resolve(args[++index])
    } else if (arg === '--workspace' && args[index + 1]) {
      workspaces.push(path.resolve(args[++index]))
    } else if (arg === '--strict') {
      strict = true
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: memory-health [--memory <path>] [--workspace <path> ...] [--strict]')
      process.exit(0)
    }
  }

  return { memoryRoot, workspaces: workspaces.length > 0 ? workspaces : [process.cwd()], strict }
}

if (isDirectCliInvocation(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  const report = inspectMemoryHealth(options.memoryRoot, options.workspaces)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (options.strict && !report.healthy) process.exitCode = 1
}
