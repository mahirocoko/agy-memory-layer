#!/usr/bin/env node

/**
 * Auto-Dream Background Daemon for agy-memory-layer
 * Scans historical and recent conversations in ~/.gemini/antigravity-cli/brain/
 * Synthesizes explicit durable corrections into recall-only project archives.
 * Inspired by Letta Code sleep-time reflection architecture & Step-Count triggers (DEFAULT_STEP_COUNT = 20)
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  assertMemoryRepositoryCleanForWrite,
  commitMemoryPaths,
  getMemoryHeadRevision,
  restoreDeclaredMemoryPaths,
  validateProjectSlug,
  writeMemoryFile,
} from './memory-repository.ts'
import { acquireMemoryWriteLock, releaseMemoryWriteLock } from './memory-write-lock.ts'
import { readConversationWorkspaceMap, resolveProjectSlug } from './workspace-identity.ts'

export type DreamState = {
  lastRun: string | null
  stepCountThreshold: number
  lastDreamedSteps: Record<string, number>
}

export type PendingConversation = {
  id: string
  shortId: string
  mtime: Date
  ageMinutes: number
  steps: number
  firstPrompt: string
  logPath: string
  workspacePath: string
  projectSlug: string
}

export type ScanOptions = {
  minSteps?: number
  idleMinutes?: number
  force?: boolean
  stepCount?: number
}

export type ProcessedDreamResult = {
  convId: string
  shortId: string
  status: 'written' | 'skipped'
  file?: string
}

export const DEFAULT_STEP_COUNT = 20
const memoryRoot =
  process.env.AGY_MEMORY_DIR || path.join(process.env.HOME || '', '.gemini', 'memory')
const brainDir = path.join(process.env.HOME || '', '.gemini', 'antigravity-cli', 'brain')
const memoryStateRoot = process.env.AGY_MEMORY_STATE_DIR || `${memoryRoot}.state`
const stateFile = path.join(memoryStateRoot, 'dream-state.json')

export function getProjectSlug(workspaceDir: string = process.cwd()): string {
  return resolveProjectSlug(workspaceDir, memoryRoot)
}

export function getDreamState(): DreamState {
  if (fs.existsSync(stateFile)) {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
  }
  return {
    lastRun: null,
    stepCountThreshold: DEFAULT_STEP_COUNT,
    lastDreamedSteps: {},
  }
}

export function saveDreamState(state: DreamState): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8')
}

export function shouldFireStepCountTrigger(
  convId: string,
  currentSteps: number,
  options: ScanOptions = {},
): boolean {
  const threshold = options.stepCount || DEFAULT_STEP_COUNT
  const state = getDreamState()
  const lastStep = state.lastDreamedSteps[convId] || 0
  const delta = currentSteps - lastStep
  return delta >= threshold
}

export function getDreamedConversationIds(slug: string): Set<string> {
  const dreamedIds = new Set<string>()
  const evidenceDirectories = [
    path.join(memoryRoot, 'projects', slug, 'learnings'),
    path.join(memoryRoot, 'archives', 'projects', slug, 'learnings'),
  ]

  for (const evidenceDirectory of evidenceDirectories) {
    if (!fs.existsSync(evidenceDirectory)) continue
    const files = fs.readdirSync(evidenceDirectory).filter((file) => file.endsWith('.md'))
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(evidenceDirectory, file), 'utf-8')
        const matches = content.match(
          /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
        )
        if (matches) {
          matches.forEach((id) => {
            dreamedIds.add(id.toLowerCase())
          })
        }
        const nameMatch = file.match(/auto_dream_([0-9a-f]{8})/i)
        if (nameMatch) {
          dreamedIds.add(nameMatch[1].toLowerCase())
        }
      } catch {}
    }
  }

  return dreamedIds
}

export function scanPendingConversations(
  slug: string,
  options: ScanOptions = {},
): PendingConversation[] {
  if (!fs.existsSync(brainDir)) return []
  const minSteps = options.minSteps || 8
  const idleMinutes = options.idleMinutes || 15
  const dreamedIds = getDreamedConversationIds(slug)
  const dreamState = getDreamState()
  const conversationWorkspaces = readConversationWorkspaceMap()

  const entries = fs.readdirSync(brainDir, { withFileTypes: true })
  const pending: PendingConversation[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const convId = entry.name
    const shortId = convId.slice(0, 8).toLowerCase()
    const workspacePath = conversationWorkspaces.get(convId)
    if (!workspacePath) continue

    const projectSlug = resolveProjectSlug(workspacePath, memoryRoot)
    if (projectSlug !== slug) continue

    if (dreamedIds.has(convId.toLowerCase()) || dreamedIds.has(shortId)) {
      continue
    }

    const logPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl')
    if (!fs.existsSync(logPath)) continue

    try {
      const stat = fs.statSync(logPath)
      const ageMinutes = (Date.now() - stat.mtimeMs) / (1000 * 60)

      const content = fs.readFileSync(logPath, 'utf-8').trim()
      const lines = content.split('\n').filter(Boolean)
      if (lines.length < minSteps) continue
      if ((dreamState.lastDreamedSteps[convId] || 0) >= lines.length) continue

      if (ageMinutes < idleMinutes && !options.force) {
        continue
      }

      let firstPrompt = 'Active coding session'
      try {
        const first = JSON.parse(lines[0])
        if (first.content) firstPrompt = first.content.slice(0, 120).replace(/\n/g, ' ')
      } catch {}

      pending.push({
        id: convId,
        shortId,
        mtime: stat.mtime,
        ageMinutes: Math.round(ageMinutes),
        steps: lines.length,
        firstPrompt,
        logPath,
        workspacePath,
        projectSlug,
      })
    } catch {}
  }

  pending.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
  return pending
}

export function extractExplicitDurableLessons(logPath: string): string[] {
  const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean)
  const durableIntent =
    /\b(?:always remember|from now on|please remember|remember (?:this|that))\b|(?:จำไว้|ช่วยจำ|อย่าลืม|ต่อจากนี้|ครั้งต่อไป)/i
  const actionableSignal =
    /\b(?:always|avoid|do not|don't|must|never|prefer|require|should|use|uses|own|owns|mean|means|store|stores|keep|keeps)\b|(?:ห้าม|ต้อง|อย่า|ควร|ใช้|คือ|เป็น|เก็บ|เจ้าของ|ไม่ต้อง)/i
  const lessons: string[] = []

  for (const line of lines) {
    try {
      const step = JSON.parse(line)
      const content = step.content || ''

      if (step.type === 'USER_INPUT') {
        const clean = content
          .replace(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/, '$1')
          .replace(/\s+/g, ' ')
          .trim()
        if (clean.length > 0 && durableIntent.test(clean)) {
          const lesson = clean
            .replace(
              /^(?:always remember(?: (?:this|that))?|from now on|please remember(?: (?:this|that))?|remember (?:this|that))\s*[:：,-]?\s*/i,
              '',
            )
            .replace(/^(?:จำไว้(?:ว่า)?|ช่วยจำ(?:ว่า)?|อย่าลืม(?:ว่า)?|ต่อจากนี้)\s*[:：,-]?\s*/i, '')
            .trim()
            .slice(0, 400)
          if (lesson.length >= 12 && actionableSignal.test(lesson) && !lessons.includes(lesson)) {
            lessons.push(lesson)
          }
        }
      }
    } catch {}
  }

  return lessons.slice(0, 5)
}

export function synthesizeConversationLearning(
  conv: PendingConversation,
  slug: string,
): string | null {
  const lessons = extractExplicitDurableLessons(conv.logPath)
  if (lessons.length === 0) return null

  const today = new Date().toISOString().split('T')[0]
  const markdown = `---
memory_status: archived
memory_kind: correction-evidence
source_conversation: ${conv.id}
workspace: ${slug}
---
# Correction Evidence: Session conv-${conv.shortId}

**Date**: ${today}
**Conversation ID**: \`[conv-${conv.id}](conversation://${conv.id})\`
**Workspace**: \`${slug}\`
**Total Steps**: ${conv.steps}
**Source**: Explicit durable-memory intent in the user conversation

---

## Explicit Actionable Corrections
${lessons.map((lesson) => `- ${lesson}`).join('\n')}
`

  return markdown
}

export function runAutoDream(
  slug: string = getProjectSlug(),
  options: ScanOptions = {},
): ProcessedDreamResult[] {
  slug = validateProjectSlug(slug)
  const pending = scanPendingConversations(slug, options)
  console.log(`\n🌙 Auto-Dream Scheduler for Workspace: "${slug}"`)
  console.log(`   Found ${pending.length} pending conversations to process.\n`)

  if (pending.length === 0) {
    console.log('✓ All conversations have already been reviewed for correction evidence.\n')
    return []
  }

  const writeLock = acquireMemoryWriteLock(memoryRoot, `dream archive ${slug}`)
  let baseRevision: string | null = null
  let memoryCommitted = false
  const changedPaths: string[] = []
  try {
    assertMemoryRepositoryCleanForWrite(memoryRoot)
    baseRevision = getMemoryHeadRevision(memoryRoot)
    if (!baseRevision) throw new Error('Dream archive requires committed MemFS HEAD.')

    const processed: ProcessedDreamResult[] = []
    const today = new Date().toISOString().split('T')[0]
    const state = getDreamState()

    for (const conv of pending) {
      console.log(
        `  ⏳ Synthesizing conv-${conv.shortId} (${conv.steps} steps, ${conv.ageMinutes}m ago)...`,
      )
      const doc = synthesizeConversationLearning(conv, slug)
      state.lastDreamedSteps[conv.id] = conv.steps
      if (!doc) {
        processed.push({
          convId: conv.id,
          shortId: conv.shortId,
          status: 'skipped',
        })
        console.log('     ↳ Skipped: no explicit durable-memory intent found.')
        continue
      }

      const relativePath = `archives/projects/${slug}/learnings/${today}_auto_dream_${conv.shortId}.md`
      const targetFile = writeMemoryFile(memoryRoot, relativePath, doc).absolutePath

      changedPaths.push(relativePath)
      processed.push({
        convId: conv.id,
        shortId: conv.shortId,
        status: 'written',
        file: targetFile,
      })
      console.log(`     ↳ Saved to ${path.relative(memoryRoot, targetFile)}`)
    }

    if (changedPaths.length > 0) {
      commitMemoryPaths({
        memoryRoot,
        relativePaths: changedPaths,
        reason: `chore(dream): archive ${changedPaths.length} explicit correction evidence note(s)`,
      })
      memoryCommitted = true
    }
    state.lastRun = new Date().toISOString()
    saveDreamState(state)
    console.log(
      `\n✓ Dream scan complete: ${changedPaths.length} written, ${processed.length - changedPaths.length} skipped.`,
    )

    return processed
  } catch (error) {
    if (!memoryCommitted && baseRevision && changedPaths.length > 0) {
      restoreDeclaredMemoryPaths(memoryRoot, baseRevision, changedPaths)
    }
    throw error
  } finally {
    releaseMemoryWriteLock(writeLock)
  }
}

export function checkAndAutoDreamOnStepCount(
  slug: string = getProjectSlug(),
  options: ScanOptions = {},
): ProcessedDreamResult[] {
  const threshold = options.stepCount || DEFAULT_STEP_COUNT
  const pending = scanPendingConversations(slug, {
    force: true,
    minSteps: threshold,
    idleMinutes: 0,
  })
  const toProcess = pending.filter((p) =>
    shouldFireStepCountTrigger(p.id, p.steps, { stepCount: threshold }),
  )

  if (toProcess.length > 0) {
    console.log(
      `🌙 Step-Count Trigger Fired: ${toProcess.length} conversations reached >= ${threshold} steps since last reflection.`,
    )
    return runAutoDream(slug, {
      force: true,
      minSteps: threshold,
      idleMinutes: 0,
      stepCount: threshold,
    })
  }
  return []
}

export function printStatus(slug: string = getProjectSlug()): void {
  const pending = scanPendingConversations(slug, { force: true, idleMinutes: 0 })
  const dreamed = getDreamedConversationIds(slug)
  const state = getDreamState()

  console.log(`\n🌙 Auto-Dream Status for Workspace: "${slug}"`)
  console.log(`   MemFS Directory: ${path.join(memoryRoot, 'projects', slug)}`)
  console.log(`   Step-Count Trigger Threshold: ${state.stepCountThreshold} steps`)
  console.log(`   Last Auto-Dream Run: ${state.lastRun || 'Never'}`)
  console.log(`   Total Dreamed Sessions: ${dreamed.size}`)
  console.log(`   Pending Undreamed Sessions: ${pending.length}\n`)

  if (pending.length > 0) {
    console.log('📋 Pending Sessions Queue:')
    pending.slice(0, 10).forEach((p, i) => {
      const willTrigger = shouldFireStepCountTrigger(p.id, p.steps)
      const triggerIcon = willTrigger ? '⚡ [Step Trigger]' : '⏳'
      console.log(
        `   [${i + 1}] conv-${p.shortId} (${p.steps} steps, ${p.ageMinutes}m ago) ${triggerIcon}`,
      )
      console.log(`       "${p.firstPrompt}"`)
    })
    console.log('\nRun `node dream-daemon.ts --run-now` to process them immediately.\n')
  } else {
    console.log('✓ All conversation sessions are up to date in MemFS.\n')
  }
}

if (process.argv[1]?.endsWith('dream-daemon.ts')) {
  const args = process.argv.slice(2)
  const cmd = args[0] || '--status'

  if (cmd === '--status' || cmd === 'status') {
    printStatus()
  } else if (cmd === '--auto-check' || cmd === 'auto-check') {
    checkAndAutoDreamOnStepCount()
  } else if (cmd === '--run-now' || cmd === 'run' || cmd === '--run') {
    const force = args.includes('--force')
    runAutoDream(getProjectSlug(), { force, idleMinutes: 0 })
  } else if (cmd === '--install-cron') {
    try {
      const scriptPath = path.resolve(import.meta.filename)
      const cronCmd = `0 */2 * * * ${process.execPath} --experimental-strip-types ${scriptPath} --run-now >/dev/null 2>&1`
      let currentCrontab = ''
      try {
        currentCrontab = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' })
      } catch {}
      if (currentCrontab.includes('dream-daemon')) {
        console.log('✓ Auto-Dream cron job is already installed.')
      } else {
        const newCrontab = `${currentCrontab.trim()}\n${cronCmd}\n`
        execSync(`echo "${newCrontab.replace(/"/g, '\\"')}" | crontab -`)
        console.log('✓ Auto-Dream cron job installed successfully (runs every 2 hours)!')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('❌ Failed to install cron:', message)
    }
  } else if (cmd === '--uninstall-cron') {
    try {
      let currentCrontab = ''
      try {
        currentCrontab = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' })
      } catch {}
      const filtered = currentCrontab
        .split('\n')
        .filter((l) => !l.includes('dream-daemon'))
        .join('\n')
      execSync(`echo "${filtered.replace(/"/g, '\\"')}" | crontab -`)
      console.log('✓ Auto-Dream cron job removed successfully.')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('❌ Failed to remove cron:', message)
    }
  } else {
    printStatus()
  }
}
