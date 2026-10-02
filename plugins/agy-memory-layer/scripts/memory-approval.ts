#!/usr/bin/env node

/**
 * Dual-Mode Memory Approval Policy for agy-memory-layer
 * Manages 'auto' (silent commit) vs 'explicit' (human review gate) memory updates.
 * Protects layered and legacy active owners from unapproved agent mutation.
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { extractDurableSourceUnits } from './layered-memory-migration.ts'
import {
  assertMemoryRepositoryCleanForWrite,
  commitMemoryPaths,
  getMemoryHeadRevision,
  normalizeMemoryRelativePath,
  readCommittedMemoryFile,
  resolveMemoryPath,
  restoreDeclaredMemoryPaths,
  writeMemoryFile,
} from './memory-repository.ts'
import { withMemoryWriteLock } from './memory-write-lock.ts'
import {
  assertNoSharedParagraphCopies,
  createSharedProposal,
  FIXED_SHARED_OWNER,
  inspectSharedSource,
  isSharedOwnerPath,
  resolveEffectiveSharedMemorySettings,
  type SharedMemorySettings,
} from './shared-memory.ts'

export type ApprovalMode = 'auto' | 'explicit'

export type ApprovalPolicy = {
  patterns: Record<string, ApprovalMode>
  defaultMode: ApprovalMode
}

export type ApprovalProposal = {
  id: string
  baseRevision: string | null
  targetRelPath: string
  oldContent: string
  oldSha256: string
  newContent: string
  newSha256: string
  reason: string
  author: string
  diff: string
  createdAt: string
}

export type ProposeResult = {
  status: 'COMMITTED' | 'PENDING_APPROVAL'
  proposalId?: string
  diff?: string
  message: string
}

export type ProposeMemoryUpdateOptions = {
  reason?: string
  author?: string
  requireExplicit?: boolean
  memoryRoot?: string
  sharedSettings?: Partial<SharedMemorySettings>
}

export type ExplicitProposalWrite = {
  targetRelPath: string
  newContent: string
  reason?: string
  author?: string
}

export type ExplicitProposalSetResult = {
  proposalIds: string[]
  results: ProposeResult[]
}

export type ExplicitProposalSetOptions = {
  expectedHead?: string
  beforePersist?: (proposal: ApprovalProposal, index: number) => void
  memoryRoot?: string
  sharedSettings?: Partial<SharedMemorySettings>
}

export type MemoryProposalSetErrorCode = 'HEAD_RACE' | 'PERSIST_FAILED'

export class MemoryProposalSetError extends Error {
  readonly code: MemoryProposalSetErrorCode

  constructor(code: MemoryProposalSetErrorCode, message: string) {
    super(message)
    this.name = 'MemoryProposalSetError'
    this.code = code
  }
}

export type ReviewResult = {
  success: boolean
  decision: 'approve' | 'reject'
  proposal: ApprovalProposal
  message: string
}

export const PROTECTED_WORKING_HYPOTHESIS_PATTERN = 'projects/*/learnings/working-hypothesis.md'

export const resolveApprovalMemoryRoot = (override?: string): string =>
  override || process.env.AGY_MEMORY_DIR || path.join(process.env.HOME || '', '.gemini', 'memory')

export const resolveApprovalStateRoot = (memoryRoot?: string): string =>
  process.env.AGY_MEMORY_STATE_DIR || `${resolveApprovalMemoryRoot(memoryRoot)}.state`

export const resolvePolicyFile = (memoryRoot?: string): string =>
  path.join(resolveApprovalStateRoot(memoryRoot), 'approval-policy.json')

export const resolvePendingDir = (memoryRoot?: string): string =>
  path.join(resolveApprovalStateRoot(memoryRoot), 'pending-approvals')

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  defaultMode: 'explicit',
  patterns: {
    [PROTECTED_WORKING_HYPOTHESIS_PATTERN]: 'explicit',
    'system/*': 'explicit',
    'reference/*': 'explicit',
    'projects/*/system/*': 'explicit',
    'projects/*/reference/*': 'explicit',
    'projects/*/project.md': 'explicit',
    'projects/*/rules.md': 'explicit',
    'global/human.md': 'explicit',
    'global/persona.md': 'explicit',
    'projects/*/learnings/*': 'auto',
    'archives/*': 'auto',
  },
}

export function getApprovalPolicy(memoryRoot?: string): ApprovalPolicy {
  const policyFile = resolvePolicyFile(memoryRoot)
  if (fs.existsSync(policyFile)) {
    try {
      return JSON.parse(fs.readFileSync(policyFile, 'utf-8'))
    } catch {}
  }
  return DEFAULT_APPROVAL_POLICY
}

export function saveApprovalPolicy(policy: ApprovalPolicy, memoryRoot?: string): void {
  const policyFile = resolvePolicyFile(memoryRoot)
  fs.mkdirSync(path.dirname(policyFile), { recursive: true })
  fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2), 'utf-8')
}

export function matchPattern(relPath: string, pattern: string): boolean {
  const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')
  return new RegExp(`^${regexPattern}$`).test(relPath)
}

export function getApprovalModeForFile(relPath: string, memoryRoot?: string): ApprovalMode {
  const policy = getApprovalPolicy(memoryRoot)
  const normalized = normalizeMemoryRelativePath(relPath)

  if (matchPattern(normalized, PROTECTED_WORKING_HYPOTHESIS_PATTERN)) {
    return 'explicit'
  }

  for (const [pattern, mode] of Object.entries(policy.patterns)) {
    if (matchPattern(normalized, pattern)) {
      return mode
    }
  }
  return policy.defaultMode
}

const requiresLosslessCuration = (relativePath: string): boolean =>
  relativePath.startsWith('system/') ||
  relativePath.startsWith('reference/') ||
  relativePath.includes('/system/') ||
  relativePath.includes('/reference/') ||
  relativePath === 'global/human.md' ||
  relativePath === 'global/persona.md' ||
  /^projects\/[^/]+\/(project|rules)\.md$/.test(relativePath)

const assertNoDurableUnitsRemoved = (
  relativePath: string,
  oldContent: string,
  newContent: string,
): void => {
  if (!oldContent || !requiresLosslessCuration(relativePath)) return
  const newUnitTexts = new Set(
    extractDurableSourceUnits(relativePath, newContent).map((unit) => unit.text),
  )
  const removed = extractDurableSourceUnits(relativePath, oldContent).filter(
    (unit) => !newUnitTexts.has(unit.text),
  )
  if (removed.length > 0) {
    throw new Error(
      `Update would remove or paraphrase ${removed.length} durable unit(s) from ${relativePath}; use memory-curation.ts with explicit dispositions and a provenance archive.`,
    )
  }
}

function generateSimpleDiff(oldText: string, newText: string, filename: string): string {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const diffLines: string[] = [`--- a/${filename}`, `+++ b/${filename}`]

  let i = 0
  let j = 0
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diffLines.push(` ${oldLines[i]}`)
      i++
      j++
    } else if (i < oldLines.length && (j >= newLines.length || !newLines.includes(oldLines[i]))) {
      diffLines.push(`-${oldLines[i]}`)
      i++
    } else if (j < newLines.length) {
      diffLines.push(`+${newLines[j]}`)
      j++
    }
  }

  return diffLines.join('\n')
}

const PROPOSAL_ID_PATTERN = /^prop-[a-z0-9-]+$/

const createProposalId = (): string =>
  `prop-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`

type PreparedMemoryChange = {
  normalizedRel: string
  oldContent: string
  newContent: string
  diff: string
  reason: string
  author: string
  identical: boolean
}

const identicalProposalResult = (): ProposeResult => ({
  status: 'COMMITTED',
  message: 'No changes detected. Content is already identical.',
})

const prepareMemoryChange = (
  targetRelPath: string,
  newContent: string,
  options: ProposeMemoryUpdateOptions,
  memoryRoot = resolveApprovalMemoryRoot(options.memoryRoot),
): PreparedMemoryChange => {
  const { relativePath: normalizedRel } = resolveMemoryPath(memoryRoot, targetRelPath)
  assertMemoryRepositoryCleanForWrite(memoryRoot)
  const oldContent = readCommittedMemoryFile(memoryRoot, normalizedRel) || ''
  const reason = options.reason || 'Autonomous reflection or rule update'
  const author = options.author || 'Antigravity Agent'
  if (oldContent.trim() === newContent.trim()) {
    return {
      normalizedRel,
      oldContent,
      newContent,
      diff: '',
      reason,
      author,
      identical: true,
    }
  }

  const diff = generateSimpleDiff(oldContent, newContent, normalizedRel)
  assertNoDurableUnitsRemoved(normalizedRel, oldContent, newContent)
  return { normalizedRel, oldContent, newContent, diff, reason, author, identical: false }
}

const commitPreparedChange = (
  change: PreparedMemoryChange,
  memoryRoot = resolveApprovalMemoryRoot(),
): ProposeResult =>
  withMemoryWriteLock(memoryRoot, `auto update ${change.normalizedRel}`, () => {
    assertMemoryRepositoryCleanForWrite(memoryRoot)
    const baseRevision = getMemoryHeadRevision(memoryRoot)
    if (!baseRevision) throw new Error('Automatic memory update requires committed MemFS HEAD.')
    try {
      writeMemoryFile(memoryRoot, change.normalizedRel, change.newContent)
      const commit = commitMemoryPaths({
        memoryRoot,
        relativePaths: [change.normalizedRel],
        reason: `chore(memory): auto-merged update to ${change.normalizedRel}`,
        authorName: change.author,
      })
      return {
        status: 'COMMITTED',
        diff: change.diff,
        message: commit.committed
          ? `Directly merged and committed changes to ${change.normalizedRel}`
          : `No effective Git change remained for ${change.normalizedRel}`,
      }
    } catch (error) {
      restoreDeclaredMemoryPaths(memoryRoot, baseRevision, [change.normalizedRel])
      throw error
    }
  })

const buildProposal = (
  change: PreparedMemoryChange,
  memoryRoot = resolveApprovalMemoryRoot(),
): ApprovalProposal => ({
  id: createProposalId(),
  baseRevision: getMemoryHeadRevision(memoryRoot),
  targetRelPath: change.normalizedRel,
  oldContent: change.oldContent,
  oldSha256: crypto.createHash('sha256').update(change.oldContent).digest('hex'),
  newContent: change.newContent,
  newSha256: crypto.createHash('sha256').update(change.newContent).digest('hex'),
  reason: change.reason,
  author: change.author,
  diff: change.diff,
  createdAt: new Date().toISOString(),
})

const pendingProposalResult = (proposal: ApprovalProposal): ProposeResult => ({
  status: 'PENDING_APPROVAL',
  proposalId: proposal.id,
  diff: proposal.diff,
  message: `Proposal created for ${proposal.targetRelPath}. Awaiting human approval before applying.`,
})

const writeProposalFile = (
  proposal: ApprovalProposal,
  memoryRoot = resolveApprovalMemoryRoot(),
): void => {
  const pendingDir = resolvePendingDir(memoryRoot)
  fs.mkdirSync(pendingDir, { recursive: true })
  const target = path.join(pendingDir, `${proposal.id}.json`)
  const tempPath = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(proposal, null, 2), 'utf-8')
  try {
    fs.renameSync(tempPath, target)
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    throw error
  }
}

const assertHeadBeforeProposalPersist = (
  expectedHead: string | undefined,
  memoryRoot = resolveApprovalMemoryRoot(),
): void => {
  assertMemoryRepositoryCleanForWrite(memoryRoot)
  const head = getMemoryHeadRevision(memoryRoot)
  if (!head) throw new Error('Memory proposal requires committed MemFS HEAD.')
  if (expectedHead !== undefined && head !== expectedHead) {
    throw new MemoryProposalSetError('HEAD_RACE', 'MemFS HEAD changed before proposal persistence.')
  }
}

export function discardExplicitProposals(
  proposalIds: readonly string[],
  memoryRoot = resolveApprovalMemoryRoot(),
): void {
  const pendingDir = resolvePendingDir(memoryRoot)
  for (const proposalId of proposalIds) {
    if (!PROPOSAL_ID_PATTERN.test(proposalId)) continue
    fs.rmSync(path.join(pendingDir, `${proposalId}.json`), { force: true })
  }
}

export function proposeMemoryUpdate(
  targetRelPath: string,
  newContent: string,
  options: ProposeMemoryUpdateOptions = {},
): ProposeResult {
  const memoryRoot = resolveApprovalMemoryRoot(options.memoryRoot)
  const sharedSettings = resolveEffectiveSharedMemorySettings(options.sharedSettings, memoryRoot)
  if (sharedSettings.enabled) {
    if (isSharedOwnerPath(targetRelPath)) {
      const oldContent = readCommittedMemoryFile(memoryRoot, FIXED_SHARED_OWNER) || ''
      const diff = generateSimpleDiff(oldContent, newContent, FIXED_SHARED_OWNER)
      const proposal = createSharedProposal({
        memoryRoot,
        targetPath: FIXED_SHARED_OWNER,
        operation: 'write',
        sourceRoot: sharedSettings.sourceRoot,
        content: newContent,
        description: options.reason,
        message: options.author,
      })
      return {
        status: 'PENDING_APPROVAL',
        proposalId: proposal.id,
        diff,
        message: `Proposal created for ${FIXED_SHARED_OWNER}. Awaiting human approval before applying.`,
      }
    }
    const inspection = inspectSharedSource(sharedSettings, memoryRoot)
    assertNoSharedParagraphCopies(newContent, targetRelPath, inspection)
  }

  const change = prepareMemoryChange(targetRelPath, newContent, options, memoryRoot)
  if (change.identical) return identicalProposalResult()
  const mode = options.requireExplicit
    ? 'explicit'
    : getApprovalModeForFile(change.normalizedRel, memoryRoot)
  if (mode === 'auto') return commitPreparedChange(change, memoryRoot)
  const proposal = buildProposal(change, memoryRoot)
  writeProposalFile(proposal, memoryRoot)
  return pendingProposalResult(proposal)
}

export function createExplicitProposalSet(
  writes: readonly ExplicitProposalWrite[],
  options: ExplicitProposalSetOptions = {},
): ExplicitProposalSetResult {
  const memoryRoot = resolveApprovalMemoryRoot(options.memoryRoot)
  const sharedSettings = resolveEffectiveSharedMemorySettings(options.sharedSettings, memoryRoot)
  if (sharedSettings.enabled) {
    if (writes.some((write) => isSharedOwnerPath(write.targetRelPath))) {
      throw new Error(
        `Refusing explicit proposal set: batch contains protected shared owner "${FIXED_SHARED_OWNER}". Mixed batches cannot be partially applied.`,
      )
    }
  }

  const prepared = writes.map((write) =>
    prepareMemoryChange(
      write.targetRelPath,
      write.newContent,
      {
        reason: write.reason,
        author: write.author,
        requireExplicit: true,
      },
      memoryRoot,
    ),
  )
  assertHeadBeforeProposalPersist(options.expectedHead, memoryRoot)

  const results: ProposeResult[] = []
  const proposalIds: string[] = []
  const created: string[] = []
  try {
    let persistIndex = 0
    for (const change of prepared) {
      if (change.identical) {
        results.push(identicalProposalResult())
        continue
      }
      const proposal = buildProposal(change, memoryRoot)
      options.beforePersist?.(proposal, persistIndex)
      assertHeadBeforeProposalPersist(options.expectedHead, memoryRoot)
      writeProposalFile(proposal, memoryRoot)
      created.push(proposal.id)
      proposalIds.push(proposal.id)
      results.push(pendingProposalResult(proposal))
      persistIndex += 1
    }
  } catch (error) {
    discardExplicitProposals(created, memoryRoot)
    if (error instanceof MemoryProposalSetError) throw error
    throw new MemoryProposalSetError(
      'PERSIST_FAILED',
      error instanceof Error ? error.message : String(error),
    )
  }

  return { proposalIds, results }
}

export function listPendingProposals(memoryRoot?: string): ApprovalProposal[] {
  const pendingDir = resolvePendingDir(memoryRoot)
  if (!fs.existsSync(pendingDir)) return []
  const files = fs.readdirSync(pendingDir).filter((f) => f.endsWith('.json'))
  const proposals: ApprovalProposal[] = []

  for (const f of files) {
    try {
      const data: ApprovalProposal = JSON.parse(fs.readFileSync(path.join(pendingDir, f), 'utf-8'))
      proposals.push(data)
    } catch {}
  }

  proposals.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return proposals
}

export function getPendingProposal(
  proposalId: string,
  memoryRoot?: string,
): ApprovalProposal | null {
  if (!/^prop-[a-z0-9-]+$/.test(proposalId)) return null
  const pendingDir = resolvePendingDir(memoryRoot)
  const proposalPath = path.join(pendingDir, `${proposalId}.json`)
  if (!fs.existsSync(proposalPath)) return null
  try {
    return JSON.parse(fs.readFileSync(proposalPath, 'utf-8'))
  } catch {
    return null
  }
}

export function reviewProposal(
  proposalId: string,
  decision: 'approve' | 'reject',
  memoryRoot = resolveApprovalMemoryRoot(),
  options?: { sharedSettings?: Partial<SharedMemorySettings> },
): ReviewResult {
  const proposal = getPendingProposal(proposalId, memoryRoot)
  if (!proposal) {
    throw new Error(`Proposal "${proposalId}" not found.`)
  }

  const pendingDir = resolvePendingDir(memoryRoot)
  const proposalFile = path.join(pendingDir, `${proposalId}.json`)

  if (decision === 'reject') {
    if (fs.existsSync(proposalFile)) {
      fs.unlinkSync(proposalFile)
    }
    return {
      success: true,
      decision: 'reject',
      proposal,
      message: `Proposal ${proposalId} rejected and discarded.`,
    }
  }

  return withMemoryWriteLock(memoryRoot, `approve proposal ${proposalId}`, () => {
    const effective = resolveEffectiveSharedMemorySettings(options?.sharedSettings, memoryRoot)
    if (isSharedOwnerPath(proposal.targetRelPath) && effective.enabled) {
      throw new Error(
        `Shared memory proposals cannot be auto-committed into canonical source from native Agy; export the proposal using export and apply it to the source repository after review.`,
      )
    }
    const resolved = resolveMemoryPath(memoryRoot, proposal.targetRelPath)
    const currentContent = fs.existsSync(resolved.absolutePath)
      ? fs.readFileSync(resolved.absolutePath, 'utf-8')
      : ''
    if (currentContent !== proposal.oldContent) {
      throw new Error(
        `Proposal ${proposalId} is stale because ${proposal.targetRelPath} changed after review began.`,
      )
    }
    if (
      proposal.oldSha256 &&
      crypto.createHash('sha256').update(proposal.oldContent).digest('hex') !== proposal.oldSha256
    ) {
      throw new Error(`Proposal ${proposalId} has an invalid old-content receipt.`)
    }
    if (
      proposal.newSha256 &&
      crypto.createHash('sha256').update(proposal.newContent).digest('hex') !== proposal.newSha256
    ) {
      throw new Error(`Proposal ${proposalId} has an invalid new-content receipt.`)
    }
    assertNoDurableUnitsRemoved(proposal.targetRelPath, proposal.oldContent, proposal.newContent)
    if (proposal.baseRevision && getMemoryHeadRevision(memoryRoot) !== proposal.baseRevision) {
      throw new Error(
        `Proposal ${proposalId} is stale because the MemFS HEAD changed after review began.`,
      )
    }

    assertMemoryRepositoryCleanForWrite(memoryRoot)
    const baseRevision = getMemoryHeadRevision(memoryRoot)
    if (!baseRevision) throw new Error('Memory approval requires committed MemFS HEAD.')
    try {
      writeMemoryFile(memoryRoot, proposal.targetRelPath, proposal.newContent)
      commitMemoryPaths({
        memoryRoot,
        relativePaths: [proposal.targetRelPath],
        reason: `chore(memory): approved update to ${proposal.targetRelPath} (${proposal.reason})`,
        authorName: proposal.author,
      })

      try {
        if (fs.existsSync(proposalFile)) fs.unlinkSync(proposalFile)
      } catch {}

      return {
        success: true,
        decision: 'approve',
        proposal,
        message: `Proposal ${proposalId} approved and applied to ${proposal.targetRelPath}!`,
      }
    } catch (error) {
      restoreDeclaredMemoryPaths(memoryRoot, baseRevision, [proposal.targetRelPath])
      throw error
    }
  })
}

if (process.argv[1]?.endsWith('memory-approval.ts')) {
  const args = process.argv.slice(2)
  const cmd = args[0] || 'list'

  if (cmd === 'list') {
    const list = listPendingProposals()
    console.log(`\n📋 Pending Memory Proposals (${list.length}):\n`)
    if (list.length === 0) {
      console.log('   No pending memory proposals awaiting approval.')
    } else {
      list.forEach((p, i) => {
        console.log(`[${i + 1}] 🏷️  ${p.id} -> ${p.targetRelPath}`)
        console.log(`    Author: ${p.author} | Reason: ${p.reason}`)
        console.log(`    Created: ${p.createdAt}\n`)
      })
    }
    console.log('')
  } else if (cmd === 'propose') {
    const targetRelPath = args[1]
    if (!targetRelPath) {
      console.error(
        'Usage: memory-approval.ts propose <relative-path> [--reason <reason>] < content.md',
      )
      process.exit(1)
    }
    const reasonIndex = args.indexOf('--reason')
    const reason = reasonIndex >= 0 ? args[reasonIndex + 1] : undefined
    const newContent = fs.readFileSync(0, 'utf-8')
    if (!newContent.trim()) {
      console.error('Proposal content must be provided on stdin.')
      process.exit(1)
    }
    const result = proposeMemoryUpdate(targetRelPath, newContent, { reason })
    console.log(JSON.stringify(result, null, 2))
  } else if (cmd === 'approve') {
    const id = args[1]
    if (!id) {
      console.error('Usage: memory-approval.ts approve <proposalId>')
      process.exit(1)
    }
    const res = reviewProposal(id, 'approve')
    console.log(`\n✓ ${res.message}\n`)
  } else if (cmd === 'reject') {
    const id = args[1]
    if (!id) {
      console.error('Usage: memory-approval.ts reject <proposalId>')
      process.exit(1)
    }
    const res = reviewProposal(id, 'reject')
    console.log(`\n✗ ${res.message}\n`)
  }
}
