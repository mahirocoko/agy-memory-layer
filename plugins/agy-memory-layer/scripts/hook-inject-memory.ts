#!/usr/bin/env node

/**
 * PreInvocation Hook for agy-memory-layer
 * Injects Core MemFS Memory + Proactive Recent Learnings + Episodic Context into Antigravity Context.
 * Fully cross-platform (Node.js/TypeScript) and limited to local filesystem/Git metadata reads.
 */

import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  getMemoryRepositoryStatus,
  listCommittedMemoryFiles,
  readCommittedMemoryFile,
} from './memory-repository.ts'
import { resolveProjectSlug } from './workspace-identity.ts'

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

export const ACTIVE_MEMORY_BUDGET_TOKENS = 1400

export { resolveProjectSlug }

const hasActiveLearningFrontmatter = (content: string): boolean => {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1]
  return Boolean(frontmatter?.match(/^memory_status:\s*active\s*$/m))
}

const extractDurableLearningBullets = (content: string): string[] => {
  const directive =
    /\b(?:always|avoid|do not|must|never|prefer|require|should)\b|(?:ห้าม|ต้อง|อย่า|ควร)/i
  const bullets = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length > 0)
  const actionable = bullets.filter((line) => directive.test(line))
  return (actionable.length > 0 ? actionable : bullets).slice(0, 2)
}

export function getRecentLearningsSnippet(
  projectSlug: string,
  memRoot: string,
  maxItems: number = 1,
): string {
  try {
    const files = listCommittedMemoryFiles(memRoot, `projects/${projectSlug}/learnings`)
      .filter((file) => file.endsWith('.md') && !path.basename(file).startsWith('.'))
      .filter((file) => !path.basename(file).startsWith('archive_'))
      .sort((a, b) => b.localeCompare(a))

    if (files.length === 0) return ''

    const snippets: string[] = []
    for (const file of files) {
      if (snippets.length >= maxItems) break
      try {
        const content = readCommittedMemoryFile(memRoot, file)
        if (!content || !hasActiveLearningFrontmatter(content)) continue
        const bullets = extractDurableLearningBullets(content)
        if (bullets.length > 0) {
          const excerpt = bullets.map((bullet) => `  - ${bullet}`).join('\n')
          snippets.push(`- **${path.basename(file, '.md')}**:\n${excerpt}`)
        }
      } catch {}
    }

    if (snippets.length === 0) return ''
    return `### 💡 Recent Project Learnings & Durable Lessons (${projectSlug})\n${snippets.join('\n\n')}\n\n`
  } catch {
    return ''
  }
}

export function generatePreInvocationContext(
  inputJson: string,
  memoryRootOverride?: string,
): PreInvocationOutput {
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

  const memRoot =
    memoryRootOverride || process.env.AGY_MEMORY_DIR || path.join(os.homedir(), '.gemini', 'memory')
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
  const learningsText = getRecentLearningsSnippet(projectSlug, memRoot, 1)
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
  if (estTokens > ACTIVE_MEMORY_BUDGET_TOKENS) {
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
