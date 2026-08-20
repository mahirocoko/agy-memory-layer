#!/usr/bin/env node

/**
 * Letta Code -> Antigravity MemFS Memory Synchronization Engine
 * Extracts raw candidate memory payloads from ~/.letta for Agentic Cognitive Grooming.
 *
 * Rules:
 * - TypeScript type alias ONLY (no interface).
 * - Pure ESM imports with Zero external npm dependencies.
 * - Agentic Grooming Architecture (Extracts payloads for Agent distillation).
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type StatefulAgentInfo = {
  id: string
  humanSummary: string
  personaSummary: string
  referenceCount: number
  lastModified: string
  isLikelyGeneral: boolean
  detectedProjectSlug?: string
}

export type ReferenceNote = {
  name: string
  content: string
}

export type ProjectRuleNote = {
  projectSlug: string
  sourceFile: string
  content: string
}

export type AgentPayload = {
  agentId: string
  humanRaw: string
  personaRaw: string
  references: ReferenceNote[]
  projectRules: ProjectRuleNote[]
}

export type LettaSyncOptions = {
  lettaRoot?: string
  memoryRoot?: string
  dryRun?: boolean
  targetAgentId?: string
  targetScope?: 'global' | 'project'
  projectSlug?: string
  syncGlobal?: boolean
  syncProjects?: boolean
  syncReferences?: boolean
  autoCommit?: boolean
}

export type LettaSyncResult = {
  timestamp: string
  dryRun: boolean
  lettaRoot: string
  memoryRoot: string
  activeAgentId: string | null
  targetScope: 'global' | 'project'
  globalHumanUpdated: boolean
  globalPersonaUpdated: boolean
  importedReferencesCount: number
  syncedProjectsCount: number
  importedRulesCount: number
  details: string[]
  status: 'SYNCED_SUCCESSFULLY' | 'NO_LETTA_DATA_FOUND'
}

/**
 * Normalizes Markdown content with section-scoped deduplication
 */
export function compactMarkdownContent(content: string): {
  compacted: string
  deduplicatedCount: number
} {
  const lines = content.split('\n')
  const seenBullets = new Set<string>()
  const resultLines: string[] = []
  let deduplicatedCount = 0
  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      resultLines.push(line)
      continue
    }

    if (inCodeBlock) {
      resultLines.push(line)
      continue
    }

    if (trimmed.length === 0) {
      if (resultLines.length === 0 || resultLines[resultLines.length - 1].trim().length === 0) {
        continue
      }
      resultLines.push('')
      continue
    }

    if (trimmed.startsWith('#')) {
      seenBullets.clear()
      resultLines.push(line)
      continue
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const bulletKey = trimmed
        .replace(/^[-*]\s+/, '')
        .toLowerCase()
        .replace(/[^\w\s\u0E00-\u0E7F]/g, '')
        .trim()

      if (seenBullets.has(bulletKey) && bulletKey.length > 5) {
        deduplicatedCount++
        continue
      }

      seenBullets.add(bulletKey)
      resultLines.push(line)
      continue
    }

    resultLines.push(line)
  }

  let finalOutput = resultLines.join('\n').trim()
  if (finalOutput.length > 0) {
    finalOutput += '\n'
  }

  return { compacted: finalOutput, deduplicatedCount }
}

/**
 * Normalizes Letta project directory name into a clean canonical slug
 */
export function normalizeLettaProjectSlug(dirName: string): string {
  const ghMatch = dirName.match(/github\.com[_-]([a-zA-Z0-9_-]+)[_-]([a-zA-Z0-9_-]+)/)
  if (ghMatch) {
    const org = ghMatch[1].toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const repo = ghMatch[2].toLowerCase().replace(/[^a-z0-9-]/g, '-')
    return `${org}-${repo}`
  }

  const parts = dirName.split('_').filter(Boolean)
  const last = parts[parts.length - 1] || dirName
  return last.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

/**
 * Lists all stateful agents in ~/.letta/agents/ (ignoring *.md subagent manifests)
 */
export function listStatefulAgents(lettaRoot?: string): StatefulAgentInfo[] {
  const homeDir = process.env.HOME || ''
  const root = lettaRoot || path.join(homeDir, '.letta')
  const agentsDir = path.join(root, 'agents')

  if (!fs.existsSync(agentsDir)) return []

  const entries = fs.readdirSync(agentsDir)
  const agentDirs = entries.filter((e) => {
    const full = path.join(agentsDir, e)
    return e.startsWith('agent-') && fs.statSync(full).isDirectory()
  })

  const list: StatefulAgentInfo[] = []

  for (const agentId of agentDirs) {
    const full = path.join(agentsDir, agentId)
    const stat = fs.statSync(full)
    const memDir = path.join(full, 'memory')

    let humanSummary = '(none)'
    let personaSummary = '(none)'
    let isLikelyGeneral = true
    let detectedProjectSlug: string | undefined

    const humanPath = path.join(memDir, 'system', 'human.md')
    if (fs.existsSync(humanPath)) {
      const humanContent = fs.readFileSync(humanPath, 'utf-8')
      const lines = humanContent
        .split('\n')
        .filter(
          (l) =>
            l.trim().length > 0 &&
            !l.trim().startsWith('#') &&
            !l.trim().startsWith('---') &&
            !l.trim().startsWith('description:'),
        )
      humanSummary = lines.slice(0, 2).join(' ').slice(0, 140)

      const pathMatch = humanContent.match(/\/Users\/[^\s`"']+/i)
      if (pathMatch) {
        const p = pathMatch[0]
        detectedProjectSlug = path.basename(p).toLowerCase().replace(/\s+/g, '-')
        isLikelyGeneral = false
      }
    }

    const personaPath = path.join(memDir, 'system', 'persona.md')
    if (fs.existsSync(personaPath)) {
      const personaContent = fs.readFileSync(personaPath, 'utf-8')
      const lines = personaContent
        .split('\n')
        .filter(
          (l) =>
            l.trim().length > 0 &&
            !l.trim().startsWith('#') &&
            !l.trim().startsWith('---') &&
            !l.trim().startsWith('description:'),
        )
      personaSummary = lines.slice(0, 2).join(' ').slice(0, 140)
    }

    const refDir = path.join(memDir, 'reference')
    const referenceCount = fs.existsSync(refDir)
      ? fs.readdirSync(refDir).filter((f) => f.endsWith('.md')).length
      : 0

    list.push({
      id: agentId,
      humanSummary,
      personaSummary,
      referenceCount,
      lastModified: stat.mtime.toISOString(),
      isLikelyGeneral,
      detectedProjectSlug,
    })
  }

  return list.sort((a, b) => b.lastModified.localeCompare(a.lastModified))
}

/**
 * Extracts raw payload from a specific Letta agent for Cognitive Grooming
 */
export function extractAgentPayload(lettaRoot: string, agentId: string): AgentPayload | null {
  const agentDir = path.join(lettaRoot, 'agents', agentId)
  if (!fs.existsSync(agentDir)) return null

  const memDir = path.join(agentDir, 'memory')
  const humanPath = path.join(memDir, 'system', 'human.md')
  const personaPath = path.join(memDir, 'system', 'persona.md')
  const refDir = path.join(memDir, 'reference')

  const humanRaw = fs.existsSync(humanPath) ? fs.readFileSync(humanPath, 'utf-8') : ''
  const personaRaw = fs.existsSync(personaPath) ? fs.readFileSync(personaPath, 'utf-8') : ''

  const references: ReferenceNote[] = []
  if (fs.existsSync(refDir)) {
    const refFiles = fs.readdirSync(refDir).filter((f) => f.endsWith('.md'))
    for (const refFile of refFiles) {
      references.push({
        name: refFile,
        content: fs.readFileSync(path.join(refDir, refFile), 'utf-8'),
      })
    }
  }

  const projectRules: ProjectRuleNote[] = []
  const lettaProjectsDir = path.join(lettaRoot, 'projects')
  if (fs.existsSync(lettaProjectsDir)) {
    const pDirs = fs
      .readdirSync(lettaProjectsDir)
      .filter((d) => fs.statSync(path.join(lettaProjectsDir, d)).isDirectory())
    for (const pDir of pDirs) {
      const pFiles = fs
        .readdirSync(path.join(lettaProjectsDir, pDir))
        .filter((f) => f.endsWith('.md'))
      for (const pFile of pFiles) {
        projectRules.push({
          projectSlug: normalizeLettaProjectSlug(pDir),
          sourceFile: pFile,
          content: fs.readFileSync(path.join(lettaProjectsDir, pDir, pFile), 'utf-8'),
        })
      }
    }
  }

  return {
    agentId,
    humanRaw,
    personaRaw,
    references,
    projectRules,
  }
}

/**
 * Discovers the active/primary general agent in ~/.letta/agents/
 */
export function findPrimaryLettaAgent(lettaRoot: string, targetAgentId?: string): string | null {
  const agents = listStatefulAgents(lettaRoot)
  if (agents.length === 0) return null

  if (targetAgentId) {
    const match = agents.find((a) => a.id === targetAgentId)
    if (match) return match.id
  }

  const general = agents.find((a) => a.isLikelyGeneral)
  if (general) return general.id

  return agents[0].id
}

/**
 * Merges two Markdown documents losslessly with section deduplication
 */
export function mergeMarkdownDocs(existing: string, incoming: string, headerNote: string): string {
  if (!existing || existing.trim().length === 0) return incoming
  if (!incoming || incoming.trim().length === 0) return existing

  const combined = `${existing.trim()}\n\n---\n\n### 🔄 ${headerNote}\n${incoming.trim()}`
  const { compacted } = compactMarkdownContent(combined)
  return compacted
}

/**
 * Executes memory sync from Letta to MemFS
 */
export function syncLettaMemory(options: LettaSyncOptions = {}): LettaSyncResult {
  const homeDir = process.env.HOME || ''
  const lettaRoot = options.lettaRoot || path.join(homeDir, '.letta')
  const memoryRoot = options.memoryRoot || path.join(homeDir, '.gemini', 'memory')
  const isDryRun = Boolean(options.dryRun)
  const details: string[] = []

  if (!fs.existsSync(lettaRoot)) {
    return {
      timestamp: new Date().toISOString(),
      dryRun: isDryRun,
      lettaRoot,
      memoryRoot,
      activeAgentId: null,
      targetScope: 'global',
      globalHumanUpdated: false,
      globalPersonaUpdated: false,
      importedReferencesCount: 0,
      syncedProjectsCount: 0,
      importedRulesCount: 0,
      details: [`Letta directory not found at: ${lettaRoot}`],
      status: 'NO_LETTA_DATA_FOUND',
    }
  }

  const agents = listStatefulAgents(lettaRoot)
  const activeAgentId =
    options.targetAgentId || findPrimaryLettaAgent(lettaRoot, options.targetAgentId)
  const agentMeta = agents.find((a) => a.id === activeAgentId)

  const targetScope: 'global' | 'project' =
    options.targetScope || (agentMeta?.isLikelyGeneral ? 'global' : 'project')
  const projectSlug = options.projectSlug || agentMeta?.detectedProjectSlug || 'letta-imported'

  let globalHumanUpdated = false
  const globalPersonaUpdated = false
  let importedReferencesCount = 0
  let syncedProjectsCount = 0
  let importedRulesCount = 0

  if (activeAgentId) {
    const payload = extractAgentPayload(lettaRoot, activeAgentId)
    if (payload) {
      if (targetScope === 'global') {
        if (options.syncGlobal !== false && payload.humanRaw) {
          const memfsHumanPath = path.join(memoryRoot, 'global', 'human.md')
          const existingHuman = fs.existsSync(memfsHumanPath)
            ? fs.readFileSync(memfsHumanPath, 'utf-8')
            : ''

          const mergedHuman = mergeMarkdownDocs(
            existingHuman,
            payload.humanRaw,
            'Imported from Letta General Core Memory',
          )

          if (mergedHuman !== existingHuman) {
            globalHumanUpdated = true
            details.push(`Merged human.md into global profile from Letta agent (${activeAgentId})`)
            if (!isDryRun) {
              fs.mkdirSync(path.join(memoryRoot, 'global'), { recursive: true })
              fs.writeFileSync(memfsHumanPath, mergedHuman, 'utf-8')
            }
          }
        }

        if (options.syncReferences !== false) {
          const targetRefDir = path.join(memoryRoot, 'global', 'reference')
          for (const ref of payload.references) {
            const dstPath = path.join(targetRefDir, ref.name)
            if (!fs.existsSync(dstPath) || fs.readFileSync(dstPath, 'utf-8') !== ref.content) {
              importedReferencesCount++
              details.push(`Imported global reference knowledge: ${ref.name}`)
              if (!isDryRun) {
                fs.mkdirSync(targetRefDir, { recursive: true })
                fs.writeFileSync(dstPath, ref.content, 'utf-8')
              }
            }
          }
        }

        // Sync project rules from Letta projects
        if (options.syncProjects !== false && payload.projectRules.length > 0) {
          for (const pRule of payload.projectRules) {
            const memfsProjectDir = path.join(memoryRoot, 'projects', pRule.projectSlug)
            const dstRulesPath = path.join(memfsProjectDir, 'rules.md')
            const existingRules = fs.existsSync(dstRulesPath)
              ? fs.readFileSync(dstRulesPath, 'utf-8')
              : ''

            const mergedRules = mergeMarkdownDocs(
              existingRules,
              pRule.content,
              `Imported from Letta Project (${pRule.projectSlug})`,
            )

            if (mergedRules !== existingRules) {
              importedRulesCount++
              syncedProjectsCount++
              details.push(
                `Synced project rules for [${pRule.projectSlug}] from ${pRule.sourceFile}`,
              )
              if (!isDryRun) {
                fs.mkdirSync(memfsProjectDir, { recursive: true })
                fs.writeFileSync(dstRulesPath, mergedRules, 'utf-8')
              }
            }
          }
        }
      } else {
        // Project-scoped sync
        const targetProjDir = path.join(memoryRoot, 'projects', projectSlug)
        if (payload.humanRaw) {
          const targetRulesPath = path.join(targetProjDir, 'rules.md')
          const existingRules = fs.existsSync(targetRulesPath)
            ? fs.readFileSync(targetRulesPath, 'utf-8')
            : ''

          const mergedRules = mergeMarkdownDocs(
            existingRules,
            payload.humanRaw,
            `Imported from Letta Project Agent (${activeAgentId})`,
          )

          if (mergedRules !== existingRules) {
            importedRulesCount++
            syncedProjectsCount++
            details.push(`Imported agent memory into project [${projectSlug}] rules.md`)
            if (!isDryRun) {
              fs.mkdirSync(targetProjDir, { recursive: true })
              fs.writeFileSync(targetRulesPath, mergedRules, 'utf-8')
            }
          }
        }

        if (options.syncReferences !== false) {
          const targetRefDir = path.join(targetProjDir, 'learnings')
          for (const ref of payload.references) {
            const dstPath = path.join(targetRefDir, ref.name)
            if (!fs.existsSync(dstPath) || fs.readFileSync(dstPath, 'utf-8') !== ref.content) {
              importedReferencesCount++
              details.push(`Imported reference into project [${projectSlug}]: ${ref.name}`)
              if (!isDryRun) {
                fs.mkdirSync(targetRefDir, { recursive: true })
                fs.writeFileSync(dstPath, ref.content, 'utf-8')
              }
            }
          }
        }
      }
    }
  }

  // Auto-commit MemFS changes if not dry-run and modified
  if (!isDryRun && (globalHumanUpdated || importedRulesCount > 0 || importedReferencesCount > 0)) {
    if (options.autoCommit !== false && fs.existsSync(path.join(memoryRoot, '.git'))) {
      try {
        execSync('git add -A', {
          cwd: memoryRoot,
          stdio: ['ignore', 'ignore', 'pipe'],
        })
        execSync('git commit -m "sync(letta): imported core memory from Letta Code"', {
          cwd: memoryRoot,
          stdio: ['ignore', 'ignore', 'pipe'],
        })
      } catch {}
    }
  }

  return {
    timestamp: new Date().toISOString(),
    dryRun: isDryRun,
    lettaRoot,
    memoryRoot,
    activeAgentId,
    targetScope,
    globalHumanUpdated,
    globalPersonaUpdated,
    importedReferencesCount,
    syncedProjectsCount,
    importedRulesCount,
    details,
    status: 'SYNCED_SUCCESSFULLY',
  }
}

// -----------------------------------------------------------------------------
// CLI Runner
// -----------------------------------------------------------------------------
if (process.argv[1]?.endsWith('letta-sync.ts')) {
  const args = process.argv.slice(2)
  const cmd = args[0] || 'status'
  const isDryRun = args.includes('--dry-run') || cmd === 'status'

  if (cmd === 'list') {
    const agents = listStatefulAgents()
    console.log(JSON.stringify(agents, null, 2))
    process.exit(0)
  }

  if (cmd === 'payload') {
    let agentId = args[1]
    if (agentId === '--agent-id' && args[2]) {
      agentId = args[2]
    }
    const targetAgent =
      agentId || findPrimaryLettaAgent(path.join(process.env.HOME || '', '.letta'))
    if (!targetAgent) {
      console.error('No stateful Letta agent found.')
      process.exit(1)
    }
    const payload = extractAgentPayload(path.join(process.env.HOME || '', '.letta'), targetAgent)
    console.log(JSON.stringify(payload, null, 2))
    process.exit(0)
  }

  let targetAgentId: string | undefined
  let targetScope: 'global' | 'project' | undefined
  let projectSlug: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent-id' && args[i + 1]) {
      targetAgentId = args[i + 1]
    }
    if (args[i] === '--target-scope' && args[i + 1]) {
      targetScope = args[i + 1] as 'global' | 'project'
    }
    if (args[i] === '--project-slug' && args[i + 1]) {
      projectSlug = args[i + 1]
    }
  }

  console.log(
    `\n🔄 Letta Code -> MemFS Synchronization Engine (${isDryRun ? 'DRY-RUN' : 'LIVE'})\n`,
  )

  const res = syncLettaMemory({
    dryRun: isDryRun,
    targetAgentId,
    targetScope,
    projectSlug,
  })

  console.log(`- Letta Root Directory     : ${res.lettaRoot}`)
  console.log(`- Active Letta Agent UUID  : ${res.activeAgentId || 'None'}`)
  console.log(`- Target Memory Scope      : ${res.targetScope}`)
  console.log(
    `- Global Human Profile Sync: ${res.globalHumanUpdated ? '✅ Merged' : '✓ Up-to-date'}`,
  )
  console.log(`- Reference Knowledge Files: ${res.importedReferencesCount} imported`)
  console.log(
    `- Synced Project Rules     : ${res.syncedProjectsCount} projects (${res.importedRulesCount} rules)`,
  )
  console.log(`- Status                   : ${res.status}\n`)

  if (res.details.length > 0) {
    console.log(`📋 Detailed Operations:`)
    for (const d of res.details) {
      console.log(`  • ${d}`)
    }
    console.log('')
  }
}
