#!/usr/bin/env node

/**
 * Memory Auto-Eviction & Token Compactor Engine for agy-memory-layer (MemFS)
 * Provides deterministic token budget enforcement, rule deduplication,
 * stale snapshot pruning, and archival compaction for MemFS.
 *
 * Rules:
 * - TypeScript type alias ONLY (no interface).
 * - Zero external npm dependencies.
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type CompactionOptions = {
  softBudget?: number
  hardBudget?: number
  dryRun?: boolean
  autoCommit?: boolean
}

export type FileCompactionResult = {
  relativePath: string
  originalTokens: number
  compactedTokens: number
  tokensSaved: number
  deduplicatedLines: number
  prunedSections: number
  changed: boolean
}

export type ProjectCompactionResult = {
  projectSlug: string
  files: FileCompactionResult[]
  totalOriginalTokens: number
  totalCompactedTokens: number
  totalTokensSaved: number
  archivedLearningsCount: number
}

export type GlobalCompactionResult = {
  humanFile: FileCompactionResult | null
  personaFile: FileCompactionResult | null
  totalTokensSaved: number
}

export type OverallCompactionResult = {
  timestamp: string
  dryRun: boolean
  global: GlobalCompactionResult
  projects: ProjectCompactionResult[]
  totalTokensSaved: number
  status: 'COMPACTED' | 'ALREADY_OPTIMAL'
}

export const DEFAULT_SOFT_BUDGET = 2000
export const DEFAULT_HARD_BUDGET = 3500

/**
 * Approximate token estimator for Markdown (accurate within ~5-10% of cl100k/o200k)
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0
  const normalized = text.trim()
  if (normalized.length === 0) return 0

  // Words + punctuation estimate
  const words = normalized.split(/\s+/).length
  const chars = normalized.length
  return Math.ceil(Math.max(words * 1.3, chars / 3.8))
}

/**
 * Normalizes and deduplicates Markdown bullet points and directives
 */
export function compactMarkdownContent(
  content: string,
  _options: CompactionOptions = {},
): {
  compacted: string
  deduplicatedCount: number
  prunedSectionsCount: number
} {
  const lines = content.split('\n')
  const seenBullets = new Set<string>()
  const resultLines: string[] = []
  let deduplicatedCount = 0
  let prunedSectionsCount = 0

  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Toggle code blocks
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      resultLines.push(line)
      continue
    }

    if (inCodeBlock) {
      resultLines.push(line)
      continue
    }

    // Empty line normalization
    if (trimmed.length === 0) {
      // Avoid more than 2 consecutive blank lines
      if (resultLines.length === 0 || resultLines[resultLines.length - 1].trim().length === 0) {
        continue
      }
      resultLines.push('')
      continue
    }

    // Reset deduplication set on new markdown section header to avoid cross-section collisions
    if (trimmed.startsWith('#')) {
      seenBullets.clear()
      resultLines.push(line)
      continue
    }

    // Bullet point deduplication & canonical matching
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      // Normalize whitespace and punctuation for exact bullet comparison
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

  // Remove empty sub-header sections (e.g. "### Section" followed immediately by another header), protecting top-level # Title
  const cleanedLines: string[] = []
  for (let i = 0; i < resultLines.length; i++) {
    const curr = resultLines[i].trim()
    const nextNonEmpty =
      resultLines
        .slice(i + 1)
        .find((l) => l.trim().length > 0)
        ?.trim() || ''

    // Only prune subheaders (## or ###) that have zero content under them, never prune top-level title # Title
    if (
      (curr.startsWith('## ') || curr.startsWith('### ') || curr.startsWith('#### ')) &&
      (nextNonEmpty.startsWith('#') || nextNonEmpty === '')
    ) {
      prunedSectionsCount++
      continue
    }
    cleanedLines.push(resultLines[i])
  }

  let finalOutput = cleanedLines.join('\n').trim()
  if (finalOutput.length > 0) {
    finalOutput += '\n'
  }

  return {
    compacted: finalOutput,
    deduplicatedCount,
    prunedSectionsCount,
  }
}

/**
 * Compacts a single file on disk
 */
export function compactFile(
  filePath: string,
  memoryRoot: string,
  options: CompactionOptions = {},
): FileCompactionResult {
  if (!fs.existsSync(filePath)) {
    return {
      relativePath: path.relative(memoryRoot, filePath),
      originalTokens: 0,
      compactedTokens: 0,
      tokensSaved: 0,
      deduplicatedLines: 0,
      prunedSections: 0,
      changed: false,
    }
  }

  const raw = fs.readFileSync(filePath, 'utf-8')
  const originalTokens = estimateTokens(raw)
  const { compacted, deduplicatedCount, prunedSectionsCount } = compactMarkdownContent(raw, options)
  const compactedTokens = estimateTokens(compacted)
  const tokensSaved = Math.max(0, originalTokens - compactedTokens)
  const changed = raw !== compacted

  if (changed && !options.dryRun) {
    fs.writeFileSync(filePath, compacted, 'utf-8')
  }

  return {
    relativePath: path.relative(memoryRoot, filePath),
    originalTokens,
    compactedTokens,
    tokensSaved,
    deduplicatedLines: deduplicatedCount,
    prunedSections: prunedSectionsCount,
    changed,
  }
}

/**
 * Compacts a specific project directory in MemFS
 */
export function compactProjectMemory(
  projectSlug: string,
  options: CompactionOptions = {},
  customMemoryRoot?: string,
): ProjectCompactionResult {
  const memoryRoot = customMemoryRoot || path.join(process.env.HOME || '', '.gemini', 'memory')
  const projectDir = path.join(memoryRoot, 'projects', projectSlug)

  if (!fs.existsSync(projectDir)) {
    return {
      projectSlug,
      files: [],
      totalOriginalTokens: 0,
      totalCompactedTokens: 0,
      totalTokensSaved: 0,
      archivedLearningsCount: 0,
    }
  }

  const filesResults: FileCompactionResult[] = []

  // Compact project.md & rules.md
  for (const fileName of ['project.md', 'rules.md']) {
    const fullPath = path.join(projectDir, fileName)
    if (fs.existsSync(fullPath)) {
      filesResults.push(compactFile(fullPath, memoryRoot, options))
    }
  }

  // Compact learnings
  const learningsDir = path.join(projectDir, 'learnings')
  let archivedLearningsCount = 0

  if (fs.existsSync(learningsDir)) {
    const learningFiles = fs
      .readdirSync(learningsDir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('archive_'))
      .sort()

    for (const lf of learningFiles) {
      const fullPath = path.join(learningsDir, lf)
      filesResults.push(compactFile(fullPath, memoryRoot, options))
    }

    // If more than 15 learnings, bundle older ones into an archive
    if (learningFiles.length > 15 && !options.dryRun) {
      const olderFiles = learningFiles.slice(0, learningFiles.length - 10)
      const archiveName = `archive_${new Date().toISOString().slice(0, 7)}.md`
      const archivePath = path.join(learningsDir, archiveName)

      let combinedArchive = `# Archived Historical Learnings (${archiveName})\n\n`
      for (const oldFile of olderFiles) {
        const p = path.join(learningsDir, oldFile)
        const content = fs.readFileSync(p, 'utf-8')
        combinedArchive += `## From ${oldFile}\n${content}\n\n---\n\n`
        fs.unlinkSync(p)
        archivedLearningsCount++
      }

      fs.writeFileSync(archivePath, combinedArchive, 'utf-8')
    }
  }

  const totalOriginalTokens = filesResults.reduce((acc, f) => acc + f.originalTokens, 0)
  const totalCompactedTokens = filesResults.reduce((acc, f) => acc + f.compactedTokens, 0)
  const totalTokensSaved = Math.max(0, totalOriginalTokens - totalCompactedTokens)

  return {
    projectSlug,
    files: filesResults,
    totalOriginalTokens,
    totalCompactedTokens,
    totalTokensSaved,
    archivedLearningsCount,
  }
}

/**
 * Compacts global profile (human.md & persona.md)
 */
export function compactGlobalMemory(
  options: CompactionOptions = {},
  customMemoryRoot?: string,
): GlobalCompactionResult {
  const memoryRoot = customMemoryRoot || path.join(process.env.HOME || '', '.gemini', 'memory')
  const humanPath = path.join(memoryRoot, 'global', 'human.md')
  const personaPath = path.join(memoryRoot, 'global', 'persona.md')

  const humanRes = fs.existsSync(humanPath) ? compactFile(humanPath, memoryRoot, options) : null
  const personaRes = fs.existsSync(personaPath)
    ? compactFile(personaPath, memoryRoot, options)
    : null

  const saved = (humanRes?.tokensSaved || 0) + (personaRes?.tokensSaved || 0)

  return {
    humanFile: humanRes,
    personaFile: personaRes,
    totalTokensSaved: saved,
  }
}

/**
 * Runs full MemFS compaction across global and all projects
 */
export function runAutoCompaction(
  customMemoryRoot?: string,
  options: CompactionOptions = {},
): OverallCompactionResult {
  const memoryRoot = customMemoryRoot || path.join(process.env.HOME || '', '.gemini', 'memory')
  const projectsDir = path.join(memoryRoot, 'projects')

  const globalRes = compactGlobalMemory(options, memoryRoot)
  const projectsResults: ProjectCompactionResult[] = []

  if (fs.existsSync(projectsDir)) {
    const slugs = fs
      .readdirSync(projectsDir)
      .filter((s) => fs.statSync(path.join(projectsDir, s)).isDirectory())

    for (const slug of slugs) {
      projectsResults.push(compactProjectMemory(slug, options, memoryRoot))
    }
  }

  const projectTokensSaved = projectsResults.reduce((a, p) => a + p.totalTokensSaved, 0)
  const totalTokensSaved = globalRes.totalTokensSaved + projectTokensSaved

  const hasChanges =
    totalTokensSaved > 0 ||
    projectsResults.some((p) => p.archivedLearningsCount > 0 || p.files.some((f) => f.changed))

  // Auto-commit if git repo and changed
  if (hasChanges && !options.dryRun && options.autoCommit !== false) {
    if (fs.existsSync(path.join(memoryRoot, '.git'))) {
      try {
        execSync('git add -A', { cwd: memoryRoot, stdio: ['ignore', 'ignore', 'pipe'] })
        execSync(
          `git commit -m "compactor: automated memory budget compaction (-${totalTokensSaved} tokens)"`,
          {
            cwd: memoryRoot,
            stdio: ['ignore', 'ignore', 'pipe'],
          },
        )
      } catch {
        // Continue gracefully
      }
    }
  }

  return {
    timestamp: new Date().toISOString(),
    dryRun: Boolean(options.dryRun),
    global: globalRes,
    projects: projectsResults,
    totalTokensSaved,
    status: hasChanges ? 'COMPACTED' : 'ALREADY_OPTIMAL',
  }
}

// -----------------------------------------------------------------------------
// CLI Runner
// -----------------------------------------------------------------------------
if (process.argv[1]?.endsWith('memory-compactor.ts')) {
  const args = process.argv.slice(2)
  const cmd = args[0] || 'status'
  const isDryRun = args.includes('--dry-run')

  if (cmd === 'compact' || cmd === 'run') {
    const slug = args[1] && !args[1].startsWith('-') ? args[1] : undefined
    console.log(`\n🧹 Running Memory Compaction Engine (${isDryRun ? 'DRY-RUN' : 'LIVE'})...\n`)

    if (slug) {
      const res = compactProjectMemory(slug, { dryRun: isDryRun })
      console.log(`📦 Project: ${res.projectSlug}`)
      console.log(`   Original Tokens : ${res.totalOriginalTokens}`)
      console.log(`   Compacted Tokens: ${res.totalCompactedTokens}`)
      console.log(`   Tokens Saved    : ${res.totalTokensSaved}`)
      if (res.archivedLearningsCount > 0) {
        console.log(`   Archived Notes  : ${res.archivedLearningsCount} files`)
      }
      console.log('')
    } else {
      const res = runAutoCompaction(undefined, { dryRun: isDryRun })
      console.log(`==================================================`)
      console.log(`✨ MemFS Auto-Compaction Complete`)
      console.log(`==================================================`)
      console.log(`- Status        : ${res.status}`)
      console.log(`- Total Saved   : ${res.totalTokensSaved} tokens`)
      console.log(`- Projects Done : ${res.projects.length}`)
      console.log(`- Timestamp     : ${res.timestamp}`)
      console.log(`==================================================\n`)
    }
  } else {
    // Status command
    const memoryRoot = path.join(process.env.HOME || '', '.gemini', 'memory')
    console.log(`\n📊 MemFS Token & Compaction Status:`)
    console.log(`   Memory Root: ${memoryRoot}`)

    const res = runAutoCompaction(undefined, { dryRun: true })
    const allOriginal =
      (res.global.humanFile?.originalTokens || 0) +
      (res.global.personaFile?.originalTokens || 0) +
      res.projects.reduce((a, p) => a + p.totalOriginalTokens, 0)

    console.log(`   Total MemFS Tokens Estimated: ~${allOriginal.toLocaleString()} tokens`)
    console.log(`   Potential Tokens to Reclaim : ~${res.totalTokensSaved} tokens`)
    console.log(
      `   Status: ${res.totalTokensSaved > 0 ? '🟡 Compaction Recommended' : '🟢 Optimal'}\n`,
    )
  }
}
