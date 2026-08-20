#!/usr/bin/env node

/**
 * PreInvocation Hook for agy-memory-layer
 * Injects Core MemFS Memory + Proactive Recent Learnings + Episodic Context into Antigravity Context.
 * Fully cross-platform (Node.js/TypeScript) and limited to local filesystem/Git metadata reads.
 */

import { execFileSync } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  committedMemoryPathExists,
  getMemoryRepositoryStatus,
  listCommittedMemoryFiles,
  readCommittedMemoryFile,
  validateProjectSlug,
} from './memory-repository.ts'

export type PreInvocationPayload = {
  workspacePaths?: string[]
  conversationId?: string
  prompt?: string
  query?: string
}

export type InjectStep = {
  ephemeralMessage: string
}

export type PreInvocationOutput = {
  injectSteps: InjectStep[]
}

const toProjectSlug = (value: string): string => {
  const candidate = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
  return validateProjectSlug(candidate || 'workspace')
}

export function resolveProjectSlug(wsPath: string, memRoot: string): string {
  const basenameSlug = toProjectSlug(path.basename(wsPath))

  // 1. Preserve an existing committed project identity.
  if (
    committedMemoryPathExists(memRoot, `projects/${basenameSlug}/project.md`) ||
    committedMemoryPathExists(memRoot, `projects/${basenameSlug}/rules.md`)
  ) {
    return basenameSlug
  }

  // 2. Try resolving Git remote canonical slug
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: wsPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (remote) {
      const match = remote.match(/[:/]([^/:]+)\/([^/:]+?)(?:\.git)?$/)
      if (match) {
        const canonical = toProjectSlug(`${match[1]}-${match[2]}`)
        if (
          committedMemoryPathExists(memRoot, `projects/${canonical}/project.md`) ||
          committedMemoryPathExists(memRoot, `projects/${canonical}/rules.md`)
        ) {
          return canonical
        }
      }
    }
  } catch {}

  return basenameSlug
}

export function getRecentLearningsSnippet(
  projectSlug: string,
  memRoot: string,
  maxItems: number = 2,
): string {
  try {
    const files = listCommittedMemoryFiles(memRoot, `projects/${projectSlug}/learnings`)
      .filter((file) => file.endsWith('.md') && !path.basename(file).startsWith('.'))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, maxItems)

    if (files.length === 0) return ''

    const snippets: string[] = []
    for (const file of files) {
      try {
        const content = readCommittedMemoryFile(memRoot, file)
        if (!content) continue
        // Extract takeaways or primary objective
        const lines = content.split('\n').filter(Boolean)
        const durableHeaderIdx = lines.findIndex(
          (l) => l.includes('Key Takeaways') || l.includes('Durable Memory Lessons'),
        )
        let excerpt = ''
        if (durableHeaderIdx !== -1) {
          excerpt = lines.slice(durableHeaderIdx + 1, durableHeaderIdx + 4).join('\n')
        } else {
          excerpt = lines.slice(0, 3).join('\n')
        }
        if (excerpt.trim()) {
          snippets.push(`- **${path.basename(file, '.md')}**:\n${excerpt.trim()}`)
        }
      } catch {}
    }

    if (snippets.length === 0) return ''
    return `### 💡 Recent Project Learnings & Durable Lessons (${projectSlug})\n${snippets.join('\n\n')}\n\n`
  } catch {
    return ''
  }
}

export function generatePreInvocationContext(inputJson: string): PreInvocationOutput {
  let payload: PreInvocationPayload = {}
  try {
    if (inputJson?.trim()) {
      payload = JSON.parse(inputJson)
    }
  } catch {}

  const wsPath =
    payload.workspacePaths && payload.workspacePaths.length > 0
      ? payload.workspacePaths[0]
      : process.cwd()

  const memRoot = process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory')
  const projectSlug = resolveProjectSlug(wsPath, memRoot)

  let contextText = ''

  const human = readCommittedMemoryFile(memRoot, 'global/human.md')?.trim()
  if (human) {
    contextText += `### 👤 User Profile & Preferences (global/human.md)\n${human}\n\n`
  }

  const persona = readCommittedMemoryFile(memRoot, 'global/persona.md')?.trim()
  if (persona) {
    contextText += `### 🤖 Agent Persona (global/persona.md)\n${persona}\n\n`
  }

  const projectMemory = readCommittedMemoryFile(
    memRoot,
    `projects/${projectSlug}/project.md`,
  )?.trim()
  if (projectMemory) {
    contextText += `### 📁 Project Context (${projectSlug}/project.md)\n${projectMemory}\n\n`
  }

  const projectRules = readCommittedMemoryFile(memRoot, `projects/${projectSlug}/rules.md`)?.trim()
  if (projectRules) {
    contextText += `### 📋 Project Rules (${projectSlug}/rules.md)\n${projectRules}\n\n`
  }

  // Inject recent durable learnings proactively
  const learningsText = getRecentLearningsSnippet(projectSlug, memRoot, 2)
  if (learningsText) {
    contextText += learningsText
  }

  const repositoryStatus = getMemoryRepositoryStatus(memRoot)
  if (repositoryStatus.state !== 'clean') {
    const changedPaths = repositoryStatus.changedPaths.slice(0, 8).join(', ')
    const changedSuffix = changedPaths ? `\nChanged paths: ${changedPaths}` : ''
    contextText += `### ⚠️ MemFS Repository Status\n${repositoryStatus.summary}${changedSuffix}\nUncommitted memory is not active; commit or resolve it explicitly before relying on it.\n\n`
  }

  if (!contextText.trim()) {
    return { injectSteps: [] }
  }

  const estTokens = Math.ceil(contextText.length / 4)
  let reminder = ''
  if (estTokens > 1400) {
    reminder = `\n> 💡 *[MemFS Budget Notice: Injected memory is ~${estTokens} tokens. Run /dream or /doctor to consolidate if needed.]*\n`
  }

  const message = `🧠 **[MemFS Active Memory]**\n\n${contextText}${reminder}`
  return {
    injectSteps: [
      {
        ephemeralMessage: message,
      },
    ],
  }
}

// CLI Execution Handler
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let stdinData = ''
  process.stdin.setEncoding('utf-8')

  process.stdin.on('data', (chunk) => {
    stdinData += chunk
  })

  process.stdin.on('end', () => {
    const output = generatePreInvocationContext(stdinData)
    process.stdout.write(JSON.stringify(output))
  })
}
