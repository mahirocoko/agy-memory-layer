#!/usr/bin/env node

/**
 * Cross-Project Knowledge Synapse Engine for agy-memory-layer (MemFS)
 * Bridges relevant architectural learnings and solutions across different
 * workspace projects in MemFS to eliminate knowledge silos.
 *
 * Rules:
 * - TypeScript type alias ONLY (no interface).
 * - Pure ESM imports with Zero external npm dependencies.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export type VectorProfile = Map<string, number>

export type SynapseHit = {
  projectSlug: string
  fileName: string
  title: string
  snippet: string
  similarity: number
  filePath: string
}

export type SynapseQueryOptions = {
  currentProjectSlug?: string
  minSimilarity?: number
  limit?: number
}

export const DEFAULT_SYNAPSE_MIN_SIMILARITY = 0.52
export const DEFAULT_SYNAPSE_LIMIT = 3

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u0E00-\u0E7F]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
}

export function generateNGrams(word: string, n: number = 3): string[] {
  if (word.length <= n) return [word]
  const ngrams: string[] = []
  for (let i = 0; i <= word.length - n; i++) {
    ngrams.push(word.slice(i, i + n))
  }
  return ngrams
}

export function buildVectorProfile(text: string): VectorProfile {
  const profile: VectorProfile = new Map()
  const tokens = tokenize(text)

  for (const token of tokens) {
    const ngrams = generateNGrams(token, 3)
    for (const ngram of ngrams) {
      profile.set(ngram, (profile.get(ngram) || 0) + 1)
    }
  }

  let sumSquares = 0
  for (const count of profile.values()) {
    sumSquares += count * count
  }
  const magnitude = Math.sqrt(sumSquares) || 1

  for (const [ngram, count] of profile.entries()) {
    profile.set(ngram, count / magnitude)
  }

  return profile
}

export function cosineSimilarity(vecA: VectorProfile, vecB: VectorProfile): number {
  let dotProduct = 0
  for (const [ngram, valA] of vecA.entries()) {
    const valB = vecB.get(ngram)
    if (valB !== undefined) {
      dotProduct += valA * valB
    }
  }
  return dotProduct
}

/**
 * Extracts first markdown title
 */
function extractTitle(content: string, fallback: string): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# ')) {
      return trimmed.replace(/^#\s+/, '').trim()
    }
  }
  return fallback
}

/**
 * Extracts a concise 1-2 sentence takeaway from learning markdown
 */
function extractSnippet(content: string): string {
  const lines = content.split('\n')
  const takeawayIdx = lines.findIndex(
    (l) =>
      l.toLowerCase().includes('takeaway') ||
      l.toLowerCase().includes('lesson') ||
      l.toLowerCase().includes('durable'),
  )

  if (takeawayIdx !== -1) {
    const snippetLines: string[] = []
    for (let i = takeawayIdx + 1; i < Math.min(lines.length, takeawayIdx + 6); i++) {
      const line = lines[i].trim()
      if (
        line.startsWith('- ') ||
        line.startsWith('* ') ||
        (line.length > 0 && !line.startsWith('#'))
      ) {
        snippetLines.push(line.replace(/^[-*]\s+/, ''))
        if (snippetLines.length >= 2) break
      }
    }
    if (snippetLines.length > 0) {
      return snippetLines.join(' · ')
    }
  }

  // Fallback to first non-header lines
  return lines
    .filter((l) => l.trim().length > 0 && !l.trim().startsWith('#') && !l.trim().startsWith('---'))
    .slice(0, 2)
    .map((l) => l.trim().replace(/^[-*]\s+/, ''))
    .join(' · ')
    .slice(0, 180)
}

/**
 * Searches across all OTHER projects in MemFS for matching knowledge
 */
export function findCrossProjectSynapses(
  query: string,
  options: SynapseQueryOptions = {},
  customMemoryRoot?: string,
): SynapseHit[] {
  if (!query || query.trim().length === 0) return []

  const memoryRoot = customMemoryRoot || path.join(process.env.HOME || '', '.gemini', 'memory')
  const projectsDir = path.join(memoryRoot, 'projects')

  if (!fs.existsSync(projectsDir)) return []

  const queryVector = buildVectorProfile(query)
  const currentSlug = options.currentProjectSlug || ''
  const minSimilarity = options.minSimilarity || DEFAULT_SYNAPSE_MIN_SIMILARITY
  const limit = options.limit || DEFAULT_SYNAPSE_LIMIT

  const projectSlugs = fs
    .readdirSync(projectsDir)
    .filter((s) => s !== currentSlug && fs.statSync(path.join(projectsDir, s)).isDirectory())

  const hits: SynapseHit[] = []

  for (const slug of projectSlugs) {
    const learningsDir = path.join(projectsDir, slug, 'learnings')
    if (!fs.existsSync(learningsDir)) continue

    const files = fs.readdirSync(learningsDir).filter((f) => f.endsWith('.md'))

    for (const file of files) {
      const filePath = path.join(learningsDir, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      const docVector = buildVectorProfile(content)
      const similarity = cosineSimilarity(queryVector, docVector)

      if (similarity >= minSimilarity) {
        const title = extractTitle(content, file)
        const snippet = extractSnippet(content)

        hits.push({
          projectSlug: slug,
          fileName: file,
          title,
          snippet,
          similarity,
          filePath,
        })
      }
    }
  }

  // Sort descending by similarity score
  return hits.sort((a, b) => b.similarity - a.similarity).slice(0, limit)
}

/**
 * Formats cross-project synapse hits into ephemeral injection markdown
 */
export function formatSynapseNotice(hits: SynapseHit[]): string {
  if (hits.length === 0) return ''

  let notice = `\n### 🌐 Cross-Project Knowledge Synapses\n`
  for (const hit of hits) {
    const simPercent = (hit.similarity * 100).toFixed(0)
    notice += `- **[From project: \`${hit.projectSlug}\` (${simPercent}% match)]**: ${hit.title}\n`
    if (hit.snippet) {
      notice += `  ↳ *${hit.snippet}*\n`
    }
  }
  return `${notice}\n`
}

// -----------------------------------------------------------------------------
// CLI Runner
// -----------------------------------------------------------------------------
if (process.argv[1]?.endsWith('cross-project-synapse.ts')) {
  const args = process.argv.slice(2)
  const query = args.join(' ') || 'sqlite database lock'

  console.log(`\n🌐 Cross-Project Knowledge Synapse Query: "${query}"\n`)
  const hits = findCrossProjectSynapses(query)

  if (hits.length === 0) {
    console.log(`No cross-project matches found for "${query}" (threshold >= 0.52).\n`)
  } else {
    console.log(formatSynapseNotice(hits))
  }
}
