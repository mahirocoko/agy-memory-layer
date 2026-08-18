#!/usr/bin/env node

/**
 * Memory Search Engine for agy-memory-layer (/memory search)
 * Performs fast text search across global profiles, project memories, and learnings.
 */

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

const memoryRoot =
  process.env.AGY_MEMORY_DIR || path.join(process.env.HOME || '', '.gemini', 'memory')

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

if (process.argv[1] && process.argv[1].endsWith('memory-search.ts')) {
  const args = process.argv.slice(2)
  const query = args[0]

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
