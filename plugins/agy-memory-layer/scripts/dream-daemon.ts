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
import { middleTruncateText } from './memory-compactor.ts'
import {
  assertMemoryRepositoryCleanForWrite,
  commitMemoryPaths,
  getMemoryHeadRevision,
  restoreDeclaredMemoryPaths,
  validateProjectSlug,
  writeMemoryFile,
} from './memory-repository.ts'
import { acquireMemoryWriteLock, releaseMemoryWriteLock } from './memory-write-lock.ts'
import {
  projectScopeExists,
  readConversationWorkspaceMap,
  resolveProjectSlug,
} from './workspace-identity.ts'

export type DreamState = {
  lastRun: string | null
  stepCountThreshold: number
  lastDreamedSteps: Record<string, number>
  lastRunByProject: Record<string, string>
}

type DreamStateRead =
  | { kind: 'missing' }
  | { kind: 'valid'; state: DreamState }
  | { kind: 'corrupt'; error: string }

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
  status: 'written' | 'skipped' | 'already-dreamed'
  file?: string
}

export type ProjectDreamOutcome = {
  slug: string
  results: ProcessedDreamResult[]
  commitSha?: string
}

export type UninitializedDreamProject = {
  slug: string
  conversations: number
}

export type CrossProjectDreamReport = {
  projects: ProjectDreamOutcome[]
  uninitialized: UninitializedDreamProject[]
}

export type DreamCliScope =
  | { kind: 'current' }
  | { kind: 'all-projects' }
  | { kind: 'project'; slug: string }

type PendingScanContext = {
  minSteps: number
  idleMinutes: number
  force: boolean
  dreamedIds: Set<string>
  dreamState: DreamState
}

type PreparedDreamNote = {
  conv: PendingConversation
  doc: string | null
}

type PreparedProjectDream = {
  slug: string
  notes: PreparedDreamNote[]
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

export function isProjectMemoryInitialized(slug: string): boolean {
  return projectScopeExists(memoryRoot, validateProjectSlug(slug))
}

const createDefaultDreamState = (): DreamState => ({
  lastRun: null,
  stepCountThreshold: DEFAULT_STEP_COUNT,
  lastDreamedSteps: {},
  lastRunByProject: {},
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeDreamState = (raw: unknown): DreamState => {
  if (!isRecord(raw)) throw new Error('Dream state must be a JSON object.')
  const state = createDefaultDreamState()
  if (typeof raw.lastRun === 'string') state.lastRun = raw.lastRun
  if (
    typeof raw.stepCountThreshold === 'number' &&
    Number.isFinite(raw.stepCountThreshold) &&
    raw.stepCountThreshold > 0
  ) {
    state.stepCountThreshold = raw.stepCountThreshold
  }
  if (isRecord(raw.lastDreamedSteps)) {
    for (const [convId, steps] of Object.entries(raw.lastDreamedSteps)) {
      if (typeof steps === 'number' && Number.isFinite(steps) && steps >= 0) {
        state.lastDreamedSteps[convId] = steps
      }
    }
  }
  if (isRecord(raw.lastRunByProject)) {
    for (const [slug, lastRun] of Object.entries(raw.lastRunByProject)) {
      if (typeof lastRun === 'string') state.lastRunByProject[slug] = lastRun
    }
  }
  return state
}

const readDreamStateFile = (): DreamStateRead => {
  if (!fs.existsSync(stateFile)) return { kind: 'missing' }
  try {
    return {
      kind: 'valid',
      state: normalizeDreamState(JSON.parse(fs.readFileSync(stateFile, 'utf-8'))),
    }
  } catch (error) {
    return { kind: 'corrupt', error: error instanceof Error ? error.message : String(error) }
  }
}

let corruptDreamStateWarned = false

export function getDreamState(): DreamState {
  const read = readDreamStateFile()
  if (read.kind === 'valid') return read.state
  if (read.kind === 'corrupt' && !corruptDreamStateWarned) {
    corruptDreamStateWarned = true
    console.warn(
      `⚠️ Ignoring unreadable Dream state at ${stateFile} (${read.error}); it will be preserved as a .corrupt backup on the next save.`,
    )
  }
  return createDefaultDreamState()
}

export function saveDreamState(state: DreamState): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  if (readDreamStateFile().kind === 'corrupt') {
    fs.copyFileSync(stateFile, `${stateFile}.corrupt-${Date.now()}`)
  }
  const tempPath = `${stateFile}.tmp-${process.pid}-${Date.now()}`
  try {
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf-8')
    fs.renameSync(tempPath, stateFile)
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    throw error
  }
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

const collectDreamedIds = (evidenceDirectories: string[]): Set<string> => {
  const dreamedIds = new Set<string>()
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

export function getDreamedConversationIds(slug: string): Set<string> {
  return collectDreamedIds([
    path.join(memoryRoot, 'projects', slug, 'learnings'),
    path.join(memoryRoot, 'archives', 'projects', slug, 'learnings'),
  ])
}

const listProjectLearningDirectories = (projectsRoot: string): string[] => {
  if (!fs.existsSync(projectsRoot)) return []
  return fs
    .readdirSync(projectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(projectsRoot, entry.name, 'learnings'))
}

export function getAllDreamedConversationIds(): Set<string> {
  return collectDreamedIds([
    ...listProjectLearningDirectories(path.join(memoryRoot, 'projects')),
    ...listProjectLearningDirectories(path.join(memoryRoot, 'archives', 'projects')),
  ])
}

const createScanContext = (dreamedIds: Set<string>, options: ScanOptions): PendingScanContext => ({
  minSteps: options.minSteps || 8,
  idleMinutes: options.idleMinutes || 15,
  force: Boolean(options.force),
  dreamedIds,
  dreamState: getDreamState(),
})

const isConversationDreamed = (convId: string, dreamedIds: Set<string>): boolean =>
  dreamedIds.has(convId.toLowerCase()) || dreamedIds.has(convId.slice(0, 8).toLowerCase())

const readPendingConversation = (
  convId: string,
  workspacePath: string,
  context: PendingScanContext,
  resolveSlug: () => string,
): PendingConversation | null => {
  if (isConversationDreamed(convId, context.dreamedIds)) return null

  const logPath = path.join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl')
  if (!fs.existsSync(logPath)) return null

  try {
    const stat = fs.statSync(logPath)
    const ageMinutes = (Date.now() - stat.mtimeMs) / (1000 * 60)

    const content = fs.readFileSync(logPath, 'utf-8').trim()
    const lines = content.split('\n').filter(Boolean)
    if (lines.length < context.minSteps) return null
    if ((context.dreamState.lastDreamedSteps[convId] || 0) >= lines.length) return null
    if (ageMinutes < context.idleMinutes && !context.force) return null

    let firstPrompt = 'Active coding session'
    try {
      const first = JSON.parse(lines[0])
      if (first.content) firstPrompt = first.content.slice(0, 120).replace(/\n/g, ' ')
    } catch {}

    return {
      id: convId,
      shortId: convId.slice(0, 8).toLowerCase(),
      mtime: stat.mtime,
      ageMinutes: Math.round(ageMinutes),
      steps: lines.length,
      firstPrompt,
      logPath,
      workspacePath,
      projectSlug: resolveSlug(),
    }
  } catch {
    return null
  }
}

const sortByRecency = (pending: PendingConversation[]): PendingConversation[] =>
  pending.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

const listBrainConversationIds = (): string[] =>
  fs
    .readdirSync(brainDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)

export function scanPendingConversations(
  slug: string,
  options: ScanOptions = {},
): PendingConversation[] {
  if (!fs.existsSync(brainDir)) return []
  const context = createScanContext(getDreamedConversationIds(slug), options)
  const conversationWorkspaces = readConversationWorkspaceMap()
  const pending: PendingConversation[] = []

  for (const convId of listBrainConversationIds()) {
    const workspacePath = conversationWorkspaces.get(convId)
    if (!workspacePath) continue

    const projectSlug = resolveProjectSlug(workspacePath, memoryRoot)
    if (projectSlug !== slug) continue

    const conversation = readPendingConversation(convId, workspacePath, context, () => projectSlug)
    if (conversation) pending.push(conversation)
  }

  return sortByRecency(pending)
}

export function scanAllPendingConversations(
  options: ScanOptions = {},
): Map<string, PendingConversation[]> {
  const grouped = new Map<string, PendingConversation[]>()
  if (!fs.existsSync(brainDir)) return grouped
  const context = createScanContext(getAllDreamedConversationIds(), options)
  const conversationWorkspaces = readConversationWorkspaceMap()
  const slugByWorkspace = new Map<string, string>()

  const resolveCachedSlug = (workspacePath: string): string => {
    const cached = slugByWorkspace.get(workspacePath)
    if (cached) return cached
    const resolved = resolveProjectSlug(workspacePath, memoryRoot)
    slugByWorkspace.set(workspacePath, resolved)
    return resolved
  }

  for (const convId of listBrainConversationIds()) {
    const workspacePath = conversationWorkspaces.get(convId)
    if (!workspacePath) continue

    const conversation = readPendingConversation(convId, workspacePath, context, () =>
      resolveCachedSlug(workspacePath),
    )
    if (!conversation) continue
    const group = grouped.get(conversation.projectSlug) || []
    group.push(conversation)
    grouped.set(conversation.projectSlug, group)
  }

  for (const group of grouped.values()) sortByRecency(group)
  return new Map([...grouped].sort(([a], [b]) => a.localeCompare(b)))
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
        const rawContent = middleTruncateText(content, 4000)
        const clean = rawContent
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
    state.lastRunByProject[slug] = state.lastRun
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

const partitionProjectGroups = (
  grouped: Map<string, PendingConversation[]>,
): {
  initialized: [string, PendingConversation[]][]
  uninitialized: UninitializedDreamProject[]
} => {
  const initialized: [string, PendingConversation[]][] = []
  const uninitialized: UninitializedDreamProject[] = []
  for (const [slug, conversations] of grouped) {
    if (conversations.length === 0) continue
    if (isProjectMemoryInitialized(slug)) initialized.push([slug, conversations])
    else uninitialized.push({ slug, conversations: conversations.length })
  }
  return { initialized, uninitialized }
}

const printUninitializedProjects = (uninitialized: UninitializedDreamProject[]): void => {
  if (uninitialized.length === 0) return
  console.log('\n⚠️  Skipped projects without MemFS project memory (run /init in that workspace):')
  for (const project of uninitialized) {
    console.log(`   - ${project.slug}: not initialized (${project.conversations} conversations)`)
  }
}

const wasDreamedSinceScan = (
  conv: PendingConversation,
  state: DreamState,
  dreamedIds: Set<string>,
): boolean =>
  isConversationDreamed(conv.id, dreamedIds) || (state.lastDreamedSteps[conv.id] || 0) >= conv.steps

const commitProjectDream = (
  project: PreparedProjectDream,
  state: DreamState,
  dreamedIds: Set<string>,
): ProjectDreamOutcome => {
  const baseRevision = getMemoryHeadRevision(memoryRoot)
  if (!baseRevision) throw new Error('Dream archive requires committed MemFS HEAD.')
  const today = new Date().toISOString().split('T')[0]
  const results: ProcessedDreamResult[] = []
  const changedPaths: string[] = []
  const advancedSteps: Record<string, number> = {}
  let memoryCommitted = false
  let commitSha: string | undefined

  console.log(`\n📁 ${project.slug}`)
  try {
    for (const { conv, doc } of project.notes) {
      if (wasDreamedSinceScan(conv, state, dreamedIds)) {
        results.push({ convId: conv.id, shortId: conv.shortId, status: 'already-dreamed' })
        console.log(`  ↳ conv-${conv.shortId}: already dreamed by another run; left untouched.`)
        continue
      }
      advancedSteps[conv.id] = conv.steps
      if (!doc) {
        results.push({ convId: conv.id, shortId: conv.shortId, status: 'skipped' })
        console.log(`  ↳ conv-${conv.shortId}: skipped, no explicit durable-memory intent found.`)
        continue
      }

      const relativePath = `archives/projects/${project.slug}/learnings/${today}_auto_dream_${conv.shortId}.md`
      const targetFile = writeMemoryFile(memoryRoot, relativePath, doc).absolutePath
      changedPaths.push(relativePath)
      results.push({
        convId: conv.id,
        shortId: conv.shortId,
        status: 'written',
        file: targetFile,
      })
      console.log(`  ↳ conv-${conv.shortId}: saved to ${relativePath}`)
    }

    if (changedPaths.length > 0) {
      commitSha = commitMemoryPaths({
        memoryRoot,
        relativePaths: changedPaths,
        reason: `chore(dream): archive ${changedPaths.length} explicit correction evidence note(s) for ${project.slug}`,
      }).sha
      memoryCommitted = true
    }
  } catch (error) {
    if (!memoryCommitted && changedPaths.length > 0) {
      restoreDeclaredMemoryPaths(memoryRoot, baseRevision, changedPaths)
    }
    throw error
  }

  Object.assign(state.lastDreamedSteps, advancedSteps)
  state.lastRun = new Date().toISOString()
  state.lastRunByProject[project.slug] = state.lastRun
  saveDreamState(state)

  return { slug: project.slug, results, commitSha }
}

const printCrossProjectSummary = (report: CrossProjectDreamReport): void => {
  if (report.projects.length > 0) console.log('\n✓ Cross-project Dream complete:')
  for (const outcome of report.projects) {
    const count = (status: ProcessedDreamResult['status']): number =>
      outcome.results.filter((result) => result.status === status).length
    const commit = outcome.commitSha ? ` (commit ${outcome.commitSha.slice(0, 7)})` : ''
    console.log(
      `   - ${outcome.slug}: ${count('written')} written, ${count('skipped')} skipped, ${count('already-dreamed')} already dreamed${commit}`,
    )
  }
  printUninitializedProjects(report.uninitialized)
  console.log('')
}

export function runCrossProjectDream(
  grouped: Map<string, PendingConversation[]>,
): CrossProjectDreamReport {
  const { initialized, uninitialized } = partitionProjectGroups(grouped)
  const pendingCount = initialized.reduce((sum, [, conversations]) => sum + conversations.length, 0)
  console.log('\n🌙 Cross-Project Auto-Dream')
  console.log(
    `   Found ${pendingCount} pending conversations across ${initialized.length} initialized project(s).`,
  )

  const report: CrossProjectDreamReport = { projects: [], uninitialized }
  if (initialized.length === 0) {
    console.log('✓ No initialized project has conversations pending correction review.')
    printCrossProjectSummary(report)
    return report
  }

  const prepared: PreparedProjectDream[] = initialized.map(([slug, conversations]) => {
    const validSlug = validateProjectSlug(slug)
    return {
      slug: validSlug,
      notes: conversations.map((conv) => {
        console.log(
          `  ⏳ Synthesizing ${validSlug}/conv-${conv.shortId} (${conv.steps} steps, ${conv.ageMinutes}m ago)...`,
        )
        return { conv, doc: synthesizeConversationLearning(conv, validSlug) }
      }),
    }
  })

  const writeLock = acquireMemoryWriteLock(memoryRoot, 'dream archive all-projects')
  try {
    assertMemoryRepositoryCleanForWrite(memoryRoot)
    const state = getDreamState()
    const dreamedIds = getAllDreamedConversationIds()
    for (const project of prepared) {
      report.projects.push(commitProjectDream(project, state, dreamedIds))
    }
  } finally {
    releaseMemoryWriteLock(writeLock)
  }

  printCrossProjectSummary(report)
  return report
}

export function runProjectDream(slug: string, options: ScanOptions = {}): CrossProjectDreamReport {
  const validSlug = validateProjectSlug(slug)
  const grouped = scanAllPendingConversations(options)
  const conversations = grouped.get(validSlug)
  if (!conversations || conversations.length === 0) {
    const knownSlugs = [...grouped.keys()]
    console.log(`\n🌙 0 conversations mapped to ${validSlug}.`)
    console.log(
      knownSlugs.length > 0
        ? `   Projects with pending conversations: ${knownSlugs.join(', ')}\n`
        : '   No project has pending conversations.\n',
    )
    return { projects: [], uninitialized: [] }
  }
  return runCrossProjectDream(new Map([[validSlug, conversations]]))
}

export function printAllProjectsStatus(): void {
  const grouped = scanAllPendingConversations({ force: true, idleMinutes: 0 })
  const { initialized, uninitialized } = partitionProjectGroups(grouped)
  const state = getDreamState()

  console.log('\n🌙 Auto-Dream Status for All Projects')
  console.log(`   Step-Count Trigger Threshold: ${state.stepCountThreshold} steps`)
  console.log(`   Last Auto-Dream Run: ${state.lastRun || 'Never'}`)

  if (initialized.length === 0) {
    console.log('\n✓ No initialized project has pending undreamed sessions.')
  } else {
    console.log('\n📋 Pending Sessions by Project:')
    for (const [slug, conversations] of initialized) {
      const triggered = conversations.filter((conv) =>
        shouldFireStepCountTrigger(conv.id, conv.steps),
      ).length
      console.log(
        `   - ${slug}: ${conversations.length} pending, ${triggered} at step trigger (last run: ${state.lastRunByProject[slug] || 'Never'})`,
      )
    }
    console.log(
      '\nRun `node dream-daemon.ts --run-now --all-projects` or `--run-now --project <slug>` to process them.',
    )
  }
  printUninitializedProjects(uninitialized)
  console.log('')
}

export function parseDreamCliScope(args: string[]): DreamCliScope {
  const allProjects = args.includes('--all-projects')
  const projectIndex = args.indexOf('--project')
  if (projectIndex === -1) return allProjects ? { kind: 'all-projects' } : { kind: 'current' }
  if (allProjects) throw new Error('Use either --all-projects or --project <slug>, not both.')
  const value = args[projectIndex + 1]
  if (!value || value.startsWith('--')) throw new Error('--project requires a project slug.')
  return { kind: 'project', slug: validateProjectSlug(value) }
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

const printScopedStatus = (scope: DreamCliScope): void => {
  if (scope.kind === 'all-projects') printAllProjectsStatus()
  else if (scope.kind === 'project') printStatus(scope.slug)
  else printStatus()
}

const readCliScope = (args: string[]): DreamCliScope => {
  try {
    return parseDreamCliScope(args)
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

if (process.argv[1]?.endsWith('dream-daemon.ts')) {
  const args = process.argv.slice(2)
  const cmd = args[0] || '--status'
  const scope = readCliScope(args)

  if (cmd === '--status' || cmd === 'status') {
    printScopedStatus(scope)
  } else if (cmd === '--auto-check' || cmd === 'auto-check') {
    checkAndAutoDreamOnStepCount()
  } else if (cmd === '--run-now' || cmd === 'run' || cmd === '--run') {
    const options: ScanOptions = { force: args.includes('--force'), idleMinutes: 0 }
    if (scope.kind === 'all-projects') runCrossProjectDream(scanAllPendingConversations(options))
    else if (scope.kind === 'project') runProjectDream(scope.slug, options)
    else runAutoDream(getProjectSlug(), options)
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
    printScopedStatus(scope)
  }
}
