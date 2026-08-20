#!/usr/bin/env node

/**
 * Memory Search Engine for agy-memory-layer (/memory search)
 * Performs fast text search across global profiles, project memories, and learnings.
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type SearchMatch = {
  file: string
  relPath: string
  lineNum: number
  line: string
  score: number
}

export type MemorySearchOptions = {
  limit?: number
  scope?: string
}

export type MemoryStatus = {
  memoryRoot: string
  initialized: boolean
  globalFiles: string[]
  projects: string[]
  gitStatus: string[]
  recentCommits: string[]
}

const memoryRoot =
  process.env.AGY_MEMORY_DIR || path.join(process.env.HOME || '', '.gemini', 'memory')

export function getMemoryStatus(root: string = memoryRoot): MemoryStatus {
  const initialized = fs.existsSync(path.join(root, '.git'))
  const globalDir = path.join(root, 'global')
  const projectsDir = path.join(root, 'projects')
  const globalFiles = fs.existsSync(globalDir)
    ? fs
        .readdirSync(globalDir)
        .filter((entry) => entry.endsWith('.md'))
        .sort()
    : []
  const projects = fs.existsSync(projectsDir)
    ? fs
        .readdirSync(projectsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : []

  let gitStatus: string[] = []
  let recentCommits: string[] = []
  if (initialized) {
    try {
      gitStatus = execSync('git status --short', { cwd: root, encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean)
    } catch {}
    try {
      recentCommits = execSync('git log -5 --pretty=format:%h%x09%s', {
        cwd: root,
        encoding: 'utf-8',
      })
        .trim()
        .split('\n')
        .filter(Boolean)
    } catch {}
  }

  return { memoryRoot: root, initialized, globalFiles, projects, gitStatus, recentCommits }
}

export function printMemoryStatus(root: string = memoryRoot): void {
  const status = getMemoryStatus(root)
  console.log('\n🧠 MemFS Status\n')
  console.log(`Root: ${status.memoryRoot}`)
  console.log(`Git: ${status.initialized ? 'initialized' : 'missing'}`)
  console.log(`Global blocks: ${status.globalFiles.join(', ') || '(none)'}`)
  console.log(`Projects: ${status.projects.join(', ') || '(none)'}`)
  console.log(`Working tree: ${status.gitStatus.length === 0 ? 'clean' : 'dirty'}`)
  if (status.gitStatus.length > 0) {
    status.gitStatus.forEach((line) => {
      console.log(`  ${line}`)
    })
  }
  if (status.recentCommits.length > 0) {
    console.log('Recent snapshots:')
    status.recentCommits.forEach((line) => {
      console.log(`  ${line}`)
    })
  }
  console.log('')
}

export function searchMemory(query: string, options: MemorySearchOptions = {}): SearchMatch[] {
  if (!query?.trim()) {
    throw new Error('Search query must not be empty.')
  }

  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const results: SearchMatch[] = []

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8')
          const lines = content.split('\n')

          lines.forEach((line, idx) => {
            const lowerLine = line.toLowerCase()
            let matchCount = 0

            for (const term of queryTerms) {
              if (lowerLine.includes(term)) {
                matchCount++
              }
            }

            if (matchCount > 0) {
              results.push({
                file: fullPath,
                relPath: path.relative(memoryRoot, fullPath),
                lineNum: idx + 1,
                line: line.trim(),
                score: matchCount,
              })
            }
          })
        } catch (_e) {
          // ignore read error
        }
      }
    }
  }

  walk(memoryRoot)

  // Sort by score descending
  results.sort((a, b) => b.score - a.score)

  return results.slice(0, options.limit || 20)
}

if (process.argv[1]?.endsWith('memory-search.ts')) {
  const args = process.argv.slice(2)
  const query = args[0]

  if (query === '--status' || query === 'status') {
    printMemoryStatus()
    process.exit(0)
  }

  if (!query) {
    console.error('❌ Usage: node memory-search.ts "<search-query>"')
    process.exit(1)
  }

  const matches = searchMemory(query)
  console.log(`\n🔍 Found ${matches.length} matches for "${query}" in MemFS:\n`)

  if (matches.length === 0) {
    console.log('   No matching memory entries found.')
  } else {
    matches.forEach((m, idx) => {
      console.log(`[${idx + 1}] 📄 ${m.relPath}:${m.lineNum}`)
      console.log(`    ${m.line}\n`)
    })
  }
}
