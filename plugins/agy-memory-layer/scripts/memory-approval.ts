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

export type ReviewResult = {
  success: boolean
  decision: 'approve' | 'reject'
  proposal: ApprovalProposal
  message: string
}

export const PROTECTED_WORKING_HYPOTHESIS_PATTERN = 'projects/*/learnings/working-hypothesis.md'

const memoryRoot =
  process.env.AGY_MEMORY_DIR || path.join(process.env.HOME || '', '.gemini', 'memory')
const memoryStateRoot = process.env.AGY_MEMORY_STATE_DIR || `${memoryRoot}.state`
const policyFile = path.join(memoryStateRoot, 'approval-policy.json')
const pendingDir = path.join(memoryStateRoot, 'pending-approvals')

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

export function getApprovalPolicy(): ApprovalPolicy {
  if (fs.existsSync(policyFile)) {
    try {
      return JSON.parse(fs.readFileSync(policyFile, 'utf-8'))
    } catch {}
  }
  return DEFAULT_APPROVAL_POLICY
}

export function saveApprovalPolicy(policy: ApprovalPolicy): void {
  fs.mkdirSync(path.dirname(policyFile), { recursive: true })
  fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2), 'utf-8')
}

export function matchPattern(relPath: string, pattern: string): boolean {
  const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')
  return new RegExp(`^${regexPattern}$`).test(relPath)
}

export function getApprovalModeForFile(relPath: string): ApprovalMode {
  const policy = getApprovalPolicy()
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

export function proposeMemoryUpdate(
  targetRelPath: string,
  newContent: string,
  options: { reason?: string; author?: string } = {},
): ProposeResult {
  const { relativePath: normalizedRel } = resolveMemoryPath(memoryRoot, targetRelPath)
  assertMemoryRepositoryCleanForWrite(memoryRoot)
  const mode = getApprovalModeForFile(normalizedRel)
  const oldContent = readCommittedMemoryFile(memoryRoot, normalizedRel) || ''

  if (oldContent.trim() === newContent.trim()) {
    return {
      status: 'COMMITTED',
      message: 'No changes detected. Content is already identical.',
    }
  }

  const diff = generateSimpleDiff(oldContent, newContent, normalizedRel)
  assertNoDurableUnitsRemoved(normalizedRel, oldContent, newContent)
  const reason = options.reason || 'Autonomous reflection or rule update'
  const author = options.author || 'Antigravity Agent'

  if (mode === 'auto') {
    return withMemoryWriteLock(memoryRoot, `auto update ${normalizedRel}`, () => {
      assertMemoryRepositoryCleanForWrite(memoryRoot)
      const baseRevision = getMemoryHeadRevision(memoryRoot)
      if (!baseRevision) throw new Error('Automatic memory update requires committed MemFS HEAD.')
      try {
        writeMemoryFile(memoryRoot, normalizedRel, newContent)
        const commit = commitMemoryPaths({
          memoryRoot,
          relativePaths: [normalizedRel],
          reason: `chore(memory): auto-merged update to ${normalizedRel}`,
          authorName: author,
        })

        return {
          status: 'COMMITTED',
          diff,
          message: commit.committed
            ? `Directly merged and committed changes to ${normalizedRel}`
            : `No effective Git change remained for ${normalizedRel}`,
        }
      } catch (error) {
        restoreDeclaredMemoryPaths(memoryRoot, baseRevision, [normalizedRel])
        throw error
      }
    })
  }

  // Mode: Explicit - Create Pending Approval Proposal
  if (!fs.existsSync(pendingDir)) {
    fs.mkdirSync(pendingDir, { recursive: true })
  }

  const proposalId = `prop-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const proposal: ApprovalProposal = {
    id: proposalId,
    baseRevision: getMemoryHeadRevision(memoryRoot),
    targetRelPath: normalizedRel,
    oldContent,
    oldSha256: crypto.createHash('sha256').update(oldContent).digest('hex'),
    newContent,
    newSha256: crypto.createHash('sha256').update(newContent).digest('hex'),
    reason,
    author,
    diff,
    createdAt: new Date().toISOString(),
  }

  fs.writeFileSync(
    path.join(pendingDir, `${proposalId}.json`),
    JSON.stringify(proposal, null, 2),
    'utf-8',
  )

  return {
    status: 'PENDING_APPROVAL',
    proposalId,
    diff,
    message: `Proposal created for ${normalizedRel}. Awaiting human approval before applying.`,
  }
}

export function listPendingProposals(): ApprovalProposal[] {
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

export function getPendingProposal(proposalId: string): ApprovalProposal | null {
  if (!/^prop-[a-z0-9-]+$/.test(proposalId)) return null
  const proposalPath = path.join(pendingDir, `${proposalId}.json`)
  if (!fs.existsSync(proposalPath)) return null
  try {
    return JSON.parse(fs.readFileSync(proposalPath, 'utf-8'))
  } catch {
    return null
  }
}

export function reviewProposal(proposalId: string, decision: 'approve' | 'reject'): ReviewResult {
  const proposal = getPendingProposal(proposalId)
  if (!proposal) {
    throw new Error(`Proposal "${proposalId}" not found.`)
  }

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
