#!/usr/bin/env node

/**
 * Git Worktree Isolation Manager for agy-memory-layer
 * Creates, manages, and cleans up isolated Git worktrees for subagents.
 * Prevents subagent actions from polluting the host workspace or conflicting with IDE state.
 */

import { execSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type WorktreeOptions = {
  baseDir?: string
  branchPrefix?: string
  subagentId?: string
  ref?: string
}

export type IsolatedWorktree = {
  id: string
  worktreePath: string
  branchName: string
  baseRepo: string
  createdAt: string
}

export type WorktreeDiff = {
  hasChanges: boolean
  files: string[]
  diffStat: string
  patch: string
}

export type WorktreeApplyResult = {
  applied: boolean
  filesModified: string[]
  error?: string
}

export function getGitRoot(dir: string = process.cwd()): string {
  try {
    const root = execSync('git rev-parse --show-toplevel 2>/dev/null', {
      cwd: dir,
      encoding: 'utf-8',
    }).trim()
    if (root) return root
  } catch {}
  return dir
}

export function createIsolatedWorktree(
  repoDir: string = process.cwd(),
  options: WorktreeOptions = {},
): IsolatedWorktree {
  const gitRoot = getGitRoot(repoDir)
  const id =
    options.subagentId ||
    `agent-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const branchPrefix = options.branchPrefix || 'agy-subagent'
  const branchName = `${branchPrefix}/${id}`
  const baseRef = options.ref || 'HEAD'

  const worktreeBase = options.baseDir || path.join(gitRoot, '.agent-state', 'worktrees')
  const worktreePath = path.join(worktreeBase, id)

  // Ensure parent directory exists
  if (!fs.existsSync(worktreeBase)) {
    fs.mkdirSync(worktreeBase, { recursive: true })
  }

  // Create isolated branch and worktree
  try {
    execSync(`git worktree add -b "${branchName}" "${worktreePath}" "${baseRef}"`, {
      cwd: gitRoot,
      stdio: 'pipe',
    })
  } catch (err: any) {
    throw new Error(`Failed to create Git worktree at ${worktreePath}: ${err?.message || err}`)
  }

  return {
    id,
    worktreePath,
    branchName,
    baseRepo: gitRoot,
    createdAt: new Date().toISOString(),
  }
}

export function getWorktreeDiff(worktreePath: string): WorktreeDiff {
  if (!fs.existsSync(worktreePath)) {
    return { hasChanges: false, files: [], diffStat: '', patch: '' }
  }

  try {
    const status = execSync('git status --porcelain', {
      cwd: worktreePath,
      encoding: 'utf-8',
    }).trim()
    if (!status) {
      return { hasChanges: false, files: [], diffStat: '', patch: '' }
    }

    const files = status
      .split('\n')
      .map((l) => l.trim().split(/\s+/).slice(1).join(' '))
      .filter(Boolean)

    const diffStat = execSync('git diff HEAD --stat 2>/dev/null || true', {
      cwd: worktreePath,
      encoding: 'utf-8',
    }).trim()

    const patch = execSync('git diff HEAD 2>/dev/null || true', {
      cwd: worktreePath,
      encoding: 'utf-8',
    })

    return {
      hasChanges: files.length > 0,
      files,
      diffStat,
      patch,
    }
  } catch {
    return { hasChanges: false, files: [], diffStat: '', patch: '' }
  }
}

export function applyWorktreeChanges(
  worktree: IsolatedWorktree,
  targetRepo: string = worktree.baseRepo,
): WorktreeApplyResult {
  const diff = getWorktreeDiff(worktree.worktreePath)
  if (!diff.hasChanges || !diff.patch) {
    return { applied: true, filesModified: [] }
  }

  try {
    // Stage or apply patch directly to target repository
    const tempPatchFile = path.join('/tmp', `patch-${worktree.id}-${Date.now()}.patch`)
    fs.writeFileSync(tempPatchFile, diff.patch, 'utf-8')

    try {
      execSync(`git apply --whitespace=nowarn "${tempPatchFile}"`, {
        cwd: targetRepo,
        stdio: 'pipe',
      })
    } finally {
      if (fs.existsSync(tempPatchFile)) {
        fs.unlinkSync(tempPatchFile)
      }
    }

    return { applied: true, filesModified: diff.files }
  } catch (err: any) {
    return {
      applied: false,
      filesModified: [],
      error: `Patch application failed: ${err?.message || err}`,
    }
  }
}

export function cleanupWorktree(
  worktree: IsolatedWorktree,
  options: { deleteBranch?: boolean } = { deleteBranch: true },
): void {
  const gitRoot = worktree.baseRepo

  try {
    if (fs.existsSync(worktree.worktreePath)) {
      execSync(`git worktree remove --force "${worktree.worktreePath}"`, {
        cwd: gitRoot,
        stdio: 'ignore',
      })
    }
  } catch {
    // Fallback directory removal if git worktree remove fails
    if (fs.existsSync(worktree.worktreePath)) {
      fs.rmSync(worktree.worktreePath, { recursive: true, force: true })
      try {
        execSync('git worktree prune', { cwd: gitRoot, stdio: 'ignore' })
      } catch {}
    }
  }

  if (options.deleteBranch) {
    try {
      execSync(`git branch -D "${worktree.branchName}"`, {
        cwd: gitRoot,
        stdio: 'ignore',
      })
    } catch {}
  }
}

export function listActiveWorktrees(repoDir: string = process.cwd()): string[] {
  const gitRoot = getGitRoot(repoDir)
  try {
    const raw = execSync('git worktree list --porcelain', {
      cwd: gitRoot,
      encoding: 'utf-8',
    })
    const worktrees: string[] = []
    const lines = raw.split('\n')
    for (const l of lines) {
      if (l.startsWith('worktree ')) {
        const wtPath = l.replace('worktree ', '').trim()
        if (wtPath !== gitRoot) {
          worktrees.push(wtPath)
        }
      }
    }
    return worktrees
  } catch {
    return []
  }
}

if (process.argv[1]?.endsWith('worktree-manager.ts')) {
  const args = process.argv.slice(2)
  const cmd = args[0] || 'list'

  if (cmd === 'create') {
    const id = args[1]
    const wt = createIsolatedWorktree(process.cwd(), { subagentId: id })
    console.log(`\n🌲 Created Isolated Git Worktree:\n`)
    console.log(`   ID: ${wt.id}`)
    console.log(`   Branch: ${wt.branchName}`)
    console.log(`   Path: ${wt.worktreePath}\n`)
  } else if (cmd === 'list') {
    const list = listActiveWorktrees()
    console.log(`\n🌲 Active Subagent Worktrees (${list.length}):\n`)
    if (list.length === 0) {
      console.log('   No active isolated worktrees.')
    } else {
      list.forEach((wt, i) => {
        console.log(`   [${i + 1}] ${wt}`)
      })
    }
    console.log('')
  } else if (cmd === 'diff') {
    const wtPath = args[1]
    if (!wtPath) {
      console.error('Usage: worktree-manager.ts diff <worktreePath>')
      process.exit(1)
    }
    const diff = getWorktreeDiff(wtPath)
    console.log(`\n📊 Worktree Diff for ${wtPath}:\n`)
    console.log(`   Has changes: ${diff.hasChanges}`)
    console.log(`   Modified files: ${diff.files.join(', ') || 'None'}`)
    if (diff.diffStat) {
      console.log(`\n${diff.diffStat}\n`)
    }
  }
}
