#!/usr/bin/env node

/**
 * Hybrid Semantic Recall Engine for agy-memory-layer
 * Combines BM25 Keyword Search + Subword N-Gram Vector Cosine Similarity
 * Pure Node.js implementation with zero external runtime dependencies.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export type RecallSearchMode = 'hybrid' | 'semantic' | 'keyword'

export type RecallSearchOptions = {
  mode?: RecallSearchMode
  limit?: number
  workspace?: string | null
  bm25Weight?: number
  vectorWeight?: number
}

export type RecallHit = {
  convId: string
  shortId: string
  mtime: Date
  score: number
  bm25Score: number
  vectorScore: number
  matchedKeywords: string[]
  snippet: string
  firstPrompt: string
  stepCount: number
}

export type ConversationDoc = {
  id: string
  shortId: string
  mtime: Date
  text: string
  firstPrompt: string
  stepCount: number
}

export type BM25Stats = {
  docLengths: Map<string, number>
  avgDocLength: number
  docCount: number
  docFrequencies: Map<string, number>
}

export type VectorProfile = Map<string, number>

const BRAIN_DIR = path.join(process.env.HOME || '', '.gemini', 'antigravity-cli', 'brain')

// Subword N-gram Vectorizer (TF-IDF approximation with char 3-grams)
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u0E00-\u0E7F]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
}

export function generateNGrams(word: string, n: number = 3): string[] {
  if (word.length <= n) return [word]
  const grams: string[] = []
  for (let i = 0; i <= word.length - n; i++) {
    grams.push(word.slice(i, i + n))
  }
  return grams
}

export function buildVectorProfile(text: string): VectorProfile {
  const words = tokenize(text)
  const vector: VectorProfile = new Map()

  for (const word of words) {
    const grams = generateNGrams(word, 3)
    for (const g of grams) {
      vector.set(g, (vector.get(g) || 0) + 1)
    }
    vector.set(`w_${word}`, (vector.get(`w_${word}`) || 0) + 2)
  }

  // Normalize L2 norm
  let sumSq = 0
  for (const val of vector.values()) {
    sumSq += val * val
  }
  const norm = Math.sqrt(sumSq) || 1
  for (const [key, val] of vector.entries()) {
    vector.set(key, val / norm)
  }

  return vector
}

export function cosineSimilarity(vA: VectorProfile, vB: VectorProfile): number {
  let dotProduct = 0
  for (const [key, valA] of vA.entries()) {
    const valB = vB.get(key)
    if (valB) {
      dotProduct += valA * valB
    }
  }
  return dotProduct
}

// BM25 Keyword Ranker
export function computeBM25(
  queryTokens: string[],
  docTokens: string[],
  docId: string,
  stats: BM25Stats,
): { score: number; matched: string[] } {
  const k1 = 1.5
  const b = 0.75
  const docLen = stats.docLengths.get(docId) || docTokens.length
  const avgLen = stats.avgDocLength || 1

  const termFreqs: Map<string, number> = new Map()
  for (const t of docTokens) {
    termFreqs.set(t, (termFreqs.get(t) || 0) + 1)
  }

  let totalScore = 0
  const matched: string[] = []

  for (const q of queryTokens) {
    const tf = termFreqs.get(q) || 0
    if (tf > 0) {
      matched.push(q)
      const df = stats.docFrequencies.get(q) || 1
      const idf = Math.log((stats.docCount - df + 0.5) / (df + 0.5) + 1)
      const num = tf * (k1 + 1)
      const den = tf + k1 * (1 - b + b * (docLen / avgLen))
      totalScore += idf * (num / den)
    }
  }

  return { score: totalScore, matched }
}

export function scanAllConversations(): ConversationDoc[] {
  if (!fs.existsSync(BRAIN_DIR)) return []
  const entries = fs.readdirSync(BRAIN_DIR, { withFileTypes: true })
  const docs: ConversationDoc[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const convId = entry.name
    const logPath = path.join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl')
    if (!fs.existsSync(logPath)) continue

    try {
      const stat = fs.statSync(logPath)
      const raw = fs.readFileSync(logPath, 'utf-8').trim()
      if (!raw) continue

      const lines = raw.split('\n').filter(Boolean)
      const textParts: string[] = []
      let firstPrompt = 'Coding session'

      for (const line of lines) {
        try {
          const step = JSON.parse(line)
          if (step.content) {
            textParts.push(step.content)
            if (step.type === 'USER_INPUT' && firstPrompt === 'Coding session') {
              firstPrompt = step.content
                .replace(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/, '$1')
                .trim()
                .slice(0, 140)
                .replace(/\n/g, ' ')
            }
          }
        } catch {}
      }

      docs.push({
        id: convId,
        shortId: convId.slice(0, 8),
        mtime: stat.mtime,
        text: textParts.join(' '),
        firstPrompt,
        stepCount: lines.length,
      })
    } catch {}
  }

  return docs
}

export async function searchRecall(
  query: string,
  options: RecallSearchOptions = {},
): Promise<RecallHit[]> {
  if (!query?.trim()) {
    throw new Error('Search query must not be empty.')
  }

  const mode: RecallSearchMode = options.mode || 'hybrid'
  const limit: number = options.limit || 5
  const queryTokens = tokenize(query)
  const queryVector = buildVectorProfile(query)
  const docs = scanAllConversations()

  if (docs.length === 0) return []

  // Precompute BM25 Corpus Statistics
  const docTokensMap: Map<string, string[]> = new Map()
  const docFrequencies: Map<string, number> = new Map()
  const docLengths: Map<string, number> = new Map()
  let totalTokens = 0

  for (const doc of docs) {
    const tokens = tokenize(doc.text)
    docTokensMap.set(doc.id, tokens)
    docLengths.set(doc.id, tokens.length)
    totalTokens += tokens.length

    const uniqueTokens = new Set(tokens)
    for (const t of uniqueTokens) {
      docFrequencies.set(t, (docFrequencies.get(t) || 0) + 1)
    }
  }

  const stats: BM25Stats = {
    docLengths,
    avgDocLength: totalTokens / (docs.length || 1),
    docCount: docs.length,
    docFrequencies,
  }

  const results: RecallHit[] = []

  for (const doc of docs) {
    const docTokens = docTokensMap.get(doc.id) || []

    // 1. BM25 Lexical Score
    const { score: bm25Raw, matched } = computeBM25(queryTokens, docTokens, doc.id, stats)
    const bm25Norm = Math.min(1.0, bm25Raw / 15.0)

    // 2. Vector Semantic Cosine Score
    const docVector = buildVectorProfile(doc.text.slice(0, 8000))
    const vectorScore = cosineSimilarity(queryVector, docVector)

    // 3. Score Fusion based on Mode
    let finalScore = 0
    if (mode === 'keyword') {
      finalScore = bm25Norm
    } else if (mode === 'semantic') {
      finalScore = vectorScore
    } else {
      // Hybrid mode: 60% semantic + 40% exact keyword
      const wV = options.vectorWeight !== undefined ? options.vectorWeight : 0.6
      const wB = options.bm25Weight !== undefined ? options.bm25Weight : 0.4
      finalScore = vectorScore * wV + bm25Norm * wB
    }

    if (finalScore > 0.08 || matched.length > 0) {
      // Extract snippet
      const lowerText = doc.text.toLowerCase()
      let bestSnippet = doc.firstPrompt
      for (const q of queryTokens) {
        const idx = lowerText.indexOf(q.toLowerCase())
        if (idx !== -1) {
          const start = Math.max(0, idx - 60)
          const end = Math.min(doc.text.length, idx + 140)
          bestSnippet = `...${doc.text.slice(start, end).replace(/\n/g, ' ')}...`
          break
        }
      }

      results.push({
        convId: doc.id,
        shortId: doc.shortId,
        mtime: doc.mtime,
        score: parseFloat(finalScore.toFixed(3)),
        bm25Score: parseFloat(bm25Norm.toFixed(3)),
        vectorScore: parseFloat(vectorScore.toFixed(3)),
        matchedKeywords: matched,
        snippet: bestSnippet,
        firstPrompt: doc.firstPrompt,
        stepCount: doc.stepCount,
      })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

if (process.argv[1]?.endsWith('recall-engine.ts')) {
  const args = process.argv.slice(2)
  const cmd = args[0]

  if (cmd === 'list') {
    const conversations = scanAllConversations()
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
      .slice(0, 20)
    console.log(`\n🕘 Recent Antigravity Conversations (${conversations.length}):\n`)
    for (const conversation of conversations) {
      console.log(
        `- conv-${conversation.shortId} · ${conversation.mtime.toISOString()} · ${conversation.stepCount} steps`,
      )
      console.log(`  ${conversation.firstPrompt}`)
    }
  } else if (cmd) {
    const queryStart = cmd === 'search' || cmd === 'find' ? 1 : 0
    const query = args
      .slice(queryStart)
      .filter((arg) => arg !== '--semantic' && arg !== '--keyword')
      .join(' ')
    if (!query) {
      console.error('❌ Usage: node recall-engine.ts [search] "<query>" [--semantic | --keyword]')
      process.exit(1)
    }

    let mode: RecallSearchMode = 'hybrid'
    if (args.includes('--semantic')) mode = 'semantic'
    if (args.includes('--keyword')) mode = 'keyword'

    searchRecall(query, { mode }).then((hits) => {
      console.log(`\n🔍 Hybrid Semantic Recall Results (${hits.length} hits | Mode: ${mode}):\n`)
      if (hits.length === 0) {
        console.log('  No matching conversation sessions found.')
      } else {
        hits.forEach((h, i) => {
          console.log(
            `[${i + 1}] 🏷️ conv-${h.shortId} (Score: ${h.score} | Vector: ${h.vectorScore}, BM25: ${h.bm25Score})`,
          )
          console.log(`    📅 Date: ${h.mtime.toISOString().split('T')[0]} | Steps: ${h.stepCount}`)
          console.log(`    💬 Opening: "${h.firstPrompt}"`)
          console.log(`    📝 Match: ${h.snippet}\n`)
        })
      }
    })
  } else {
    console.log(
      'Hybrid Semantic Recall Engine. Use `node recall-engine.ts "<query>"` or `node recall-engine.ts list`',
    )
  }
}
