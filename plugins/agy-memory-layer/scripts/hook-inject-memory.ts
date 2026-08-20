#!/usr/bin/env node

/**
 * PreInvocation Hook for agy-memory-layer
 * Injects Core MemFS Memory + Proactive Recent Learnings + Episodic Context into Antigravity Context.
 * Fully cross-platform (Node.js/TypeScript) and limited to local filesystem/Git metadata reads.
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

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

export function resolveProjectSlug(wsPath: string, memRoot: string): string {
  const memProjectsDir = path.join(memRoot, 'projects')
  const basenameSlug = path.basename(wsPath).toLowerCase().replace(/\s+/g, '-')

  // 1. If folder exists in MemFS, preserve it
  if (fs.existsSync(path.join(memProjectsDir, basenameSlug))) {
    return basenameSlug
  }

  // 2. Try resolving Git remote canonical slug
  try {
    const remote = execSync('git config --get remote.origin.url', {
      cwd: wsPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (remote) {
      const match = remote.match(/[:/]([^/:]+)\/([^/:]+?)(?:\.git)?$/)
      if (match) {
        const canonical = `${match[1]}-${match[2]}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
        if (fs.existsSync(path.join(memProjectsDir, canonical))) {
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
  const learningsDir = path.join(memRoot, 'projects', projectSlug, 'learnings')
  if (!fs.existsSync(learningsDir)) return ''

  try {
    const files = fs
      .readdirSync(learningsDir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
      .map((f) => {
        const fullPath = path.join(learningsDir, f)
        const stat = fs.statSync(fullPath)
        return { file: f, path: fullPath, mtime: stat.mtime }
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
      .slice(0, maxItems)

    if (files.length === 0) return ''

    const snippets: string[] = []
    for (const f of files) {
      try {
        const content = fs.readFileSync(f.path, 'utf-8')
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
          snippets.push(`- **${f.file.replace('.md', '')}**:\n${excerpt.trim()}`)
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
  const globalHuman = path.join(memRoot, 'global', 'human.md')
  const globalPersona = path.join(memRoot, 'global', 'persona.md')
  const projectSlug = resolveProjectSlug(wsPath, memRoot)
  const projectMem = path.join(memRoot, 'projects', projectSlug, 'project.md')
  const projectRules = path.join(memRoot, 'projects', projectSlug, 'rules.md')

  let contextText = ''

  if (fs.existsSync(globalHuman)) {
    try {
      const human = fs.readFileSync(globalHuman, 'utf-8').trim()
      if (human) {
        contextText += `### 👤 User Profile & Preferences (global/human.md)\n${human}\n\n`
      }
    } catch {}
  }

  if (fs.existsSync(globalPersona)) {
    try {
      const persona = fs.readFileSync(globalPersona, 'utf-8').trim()
      if (persona) {
        contextText += `### 🤖 Agent Persona (global/persona.md)\n${persona}\n\n`
      }
    } catch {}
  }

  if (fs.existsSync(projectMem)) {
    try {
      const proj = fs.readFileSync(projectMem, 'utf-8').trim()
      if (proj) {
        contextText += `### 📁 Project Context (${projectSlug}/project.md)\n${proj}\n\n`
      }
    } catch {}
  }

  if (fs.existsSync(projectRules)) {
    try {
      const rules = fs.readFileSync(projectRules, 'utf-8').trim()
      if (rules) {
        contextText += `### 📋 Project Rules (${projectSlug}/rules.md)\n${rules}\n\n`
      }
    } catch {}
  }

  // Inject recent durable learnings proactively
  const learningsText = getRecentLearningsSnippet(projectSlug, memRoot, 2)
  if (learningsText) {
    contextText += learningsText
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
if (
  process.argv[1] &&
  (process.argv[1].endsWith('hook-inject-memory.ts') ||
    process.argv[1].endsWith('hook-inject-memory.js'))
) {
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
