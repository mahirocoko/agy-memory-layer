#!/usr/bin/env node

/**
 * Dual-Mode Memory Approval Policy for agy-memory-layer
 * Manages 'auto' (silent commit) vs 'explicit' (human review gate) memory updates.
 * Protects core project architecture (project.md) and rules (rules.md) from unapproved agent mutation.
 */

import { execSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type ApprovalMode = 'auto' | 'explicit'

export type ApprovalPolicy = {
  patterns: Record<string, ApprovalMode>
  defaultMode: ApprovalMode
}

export type ApprovalProposal = {
  id: string
  targetRelPath: string
  fullPath: string
  oldContent: string
  newContent: string
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

const memoryRoot =
  process.env.AGY_MEMORY_DIR || path.join(process.env.HOME || '', '.gemini', 'memory')
const policyFile = path.join(memoryRoot, '.approval_policy.json')
const pendingDir = path.join(memoryRoot, '.pending_approvals')

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  defaultMode: 'auto',
  patterns: {
    'projects/*/project.md': 'explicit',
    'projects/*/rules.md': 'explicit',
    'global/human.md': 'auto',
    'global/persona.md': 'auto',
    'projects/*/learnings/*': 'auto',
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
  try {
    fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2), 'utf-8')
  } catch {}
}

export function matchPattern(relPath: string, pattern: string): boolean {
  const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')
  return new RegExp(`^${regexPattern}$`).test(relPath)
}

export function getApprovalModeForFile(relPath: string): ApprovalMode {
  const policy = getApprovalPolicy()
  const normalized = relPath.replace(/\\/g, '/')

  for (const [pattern, mode] of Object.entries(policy.patterns)) {
    if (matchPattern(normalized, pattern)) {
      return mode
    }
  }
  return policy.defaultMode
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
  const normalizedRel = targetRelPath.replace(/\\/g, '/')
  const fullPath = path.join(memoryRoot, normalizedRel)
  const mode = getApprovalModeForFile(normalizedRel)
  const oldContent = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : ''

  if (oldContent.trim() === newContent.trim()) {
    return {
      status: 'COMMITTED',
      message: 'No changes detected. Content is already identical.',
    }
  }

  const diff = generateSimpleDiff(oldContent, newContent, normalizedRel)
  const reason = options.reason || 'Autonomous reflection or rule update'
  const author = options.author || 'Antigravity Agent'

  if (mode === 'auto') {
    // Mode: Auto - direct silent write and Git commit
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, newContent, 'utf-8')

    try {
      if (fs.existsSync(path.join(memoryRoot, '.git'))) {
        execSync(`git add "${normalizedRel}"`, { cwd: memoryRoot, stdio: 'ignore' })
        execSync(`git commit -m "chore(memory): auto-merged update to ${normalizedRel}"`, {
          cwd: memoryRoot,
          stdio: 'ignore',
        })
      }
    } catch {}

    return {
      status: 'COMMITTED',
      diff,
      message: `Directly merged and committed changes to ${normalizedRel}`,
    }
  }

  // Mode: Explicit - Create Pending Approval Proposal
  if (!fs.existsSync(pendingDir)) {
    fs.mkdirSync(pendingDir, { recursive: true })
  }

  const proposalId = `prop-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const proposal: ApprovalProposal = {
    id: proposalId,
    targetRelPath: normalizedRel,
    fullPath,
    oldContent,
    newContent,
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

  // Decision: Approve
  fs.mkdirSync(path.dirname(proposal.fullPath), { recursive: true })
  fs.writeFileSync(proposal.fullPath, proposal.newContent, 'utf-8')

  if (fs.existsSync(proposalFile)) {
    fs.unlinkSync(proposalFile)
  }

  try {
    if (fs.existsSync(path.join(memoryRoot, '.git'))) {
      execSync(`git add "${proposal.targetRelPath}"`, {
        cwd: memoryRoot,
        stdio: 'ignore',
      })
      execSync(
        `git commit -m "chore(memory): approved update to ${proposal.targetRelPath} (${proposal.reason})"`,
        { cwd: memoryRoot, stdio: 'ignore' },
      )
    }
  } catch {}

  return {
    success: true,
    decision: 'approve',
    proposal,
    message: `Proposal ${proposalId} approved and applied to ${proposal.targetRelPath}!`,
  }
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
