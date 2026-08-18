#!/usr/bin/env node

/**
 * Autonomous Skill Synthesizer & Auto-Promotion Engine
 * Detects recurring procedural learnings (3+ occurrences) in MemFS and drafts
 * production-ready SKILL.md packages.
 *
 * Rules:
 * - TypeScript type alias ONLY (no interface).
 * - Pure ESM imports with Zero external npm dependencies.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export type VectorProfile = Map<string, number>

export type LearningEntry = {
  filePath: string
  fileName: string
  projectSlug: string
  title: string
  content: string
  vector: VectorProfile
}

export type SkillCandidate = {
  suggestedName: string
  title: string
  description: string
  occurrenceCount: number
  matchedLearnings: Array<{
    fileName: string
    projectSlug: string
    title: string
    similarity: number
  }>
  draftSkillMd: string
}

export type SkillScanResult = {
  candidates: SkillCandidate[]
  totalLearningsScanned: number
  scanTimestamp: string
  status: 'CANDIDATES_FOUND' | 'NO_RECURRING_PATTERNS'
}

export type SynthesizerOptions = {
  minOccurrences?: number
  minSimilarity?: number
  outputDir?: string
}

export const DEFAULT_MIN_OCCURRENCES = 3
export const DEFAULT_MIN_SIMILARITY = 0.62

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
 * Extracts title from markdown content
 */
function extractMarkdownTitle(content: string, fallback: string): string {
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
 * Scans all learning files across MemFS projects
 */
export function scanMemfsLearnings(customMemoryRoot?: string): LearningEntry[] {
  const memoryRoot = customMemoryRoot || path.join(process.env.HOME || '', '.gemini', 'memory')
  const projectsDir = path.join(memoryRoot, 'projects')

  if (!fs.existsSync(projectsDir)) return []

  const entries: LearningEntry[] = []
  const projectSlugs = fs
    .readdirSync(projectsDir)
    .filter((s) => fs.statSync(path.join(projectsDir, s)).isDirectory())

  for (const slug of projectSlugs) {
    const learningsDir = path.join(projectsDir, slug, 'learnings')
    if (!fs.existsSync(learningsDir)) continue

    const files = fs.readdirSync(learningsDir).filter((f) => f.endsWith('.md'))

    for (const file of files) {
      const filePath = path.join(learningsDir, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      const title = extractMarkdownTitle(content, file)
      const vector = buildVectorProfile(content)

      entries.push({
        filePath,
        fileName: file,
        projectSlug: slug,
        title,
        content,
        vector,
      })
    }
  }

  return entries
}

/**
 * Generates production-ready SKILL.md template from clustered learnings
 */
export function generateDraftSkill(
  suggestedName: string,
  title: string,
  matchedLearnings: LearningEntry[],
): string {
  const cleanName = suggestedName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  const summaryLessons = matchedLearnings
    .slice(0, 5)
    .map((l) => `- **From ${l.projectSlug} (${l.fileName})**: ${l.title}`)
    .join('\n')

  return `---
name: ${cleanName}
description: Autonomous skill synthesized from recurring MemFS procedural patterns. Trigger on "${cleanName}" or related workflows.
---

# /${cleanName} — ${title}

Synthesized by \`agy-memory-layer\` Skill Synthesizer based on ${matchedLearnings.length} recurring occurrences.

---

## 🎯 When to Use
- When executing recurring workflows related to ${title.toLowerCase()}.
- When similar errors or procedures are encountered in project execution.

---

## 📋 Synthesized Evidence & Provenance
${summaryLessons}

---

## 🛠️ Step-by-Step Execution Workflow
1. **Preflight**: Verify environment, package manifests, and relevant configuration files.
2. **Execute**: Apply canonical steps discovered across past sessions.
3. **Verify**: Run automated tests and static checks to ensure zero regressions.

---

## ⚠️ Key Guardrails & Failure Modes
- Always verify schema definitions before modifying configuration files.
- Never commit or push without explicit user approval.
`
}

/**
 * Clusters recurring learnings and generates skill candidates
 */
export function scanAndSynthesizeSkills(
  options: SynthesizerOptions = {},
  customMemoryRoot?: string,
): SkillScanResult {
  const minOccurrences = options.minOccurrences || DEFAULT_MIN_OCCURRENCES
  const minSimilarity = options.minSimilarity || DEFAULT_MIN_SIMILARITY

  const learnings = scanMemfsLearnings(customMemoryRoot)
  if (learnings.length === 0) {
    return {
      candidates: [],
      totalLearningsScanned: 0,
      scanTimestamp: new Date().toISOString(),
      status: 'NO_RECURRING_PATTERNS',
    }
  }

  const clusters: Array<LearningEntry[]> = []
  const visited = new Set<string>()

  for (let i = 0; i < learnings.length; i++) {
    if (visited.has(learnings[i].filePath)) continue

    const currentCluster: LearningEntry[] = [learnings[i]]
    visited.add(learnings[i].filePath)

    for (let j = i + 1; j < learnings.length; j++) {
      if (visited.has(learnings[j].filePath)) continue

      const sim = cosineSimilarity(learnings[i].vector, learnings[j].vector)
      if (sim >= minSimilarity) {
        currentCluster.push(learnings[j])
        visited.add(learnings[j].filePath)
      }
    }

    if (currentCluster.length >= minOccurrences) {
      clusters.push(currentCluster)
    }
  }

  const candidates: SkillCandidate[] = clusters.map((cluster, idx) => {
    const mainTitle = cluster[0].title.replace(/^Auto-Dream Learning:\s*/i, '').trim()
    const nameSeed = mainTitle
      .split(/[:\s-]+/)
      .slice(0, 3)
      .join('-')
      .toLowerCase()
    const suggestedName = `auto-${nameSeed || `skill-${idx + 1}`}`

    const draftSkillMd = generateDraftSkill(suggestedName, mainTitle, cluster)

    return {
      suggestedName,
      title: mainTitle,
      description: `Autonomous procedural skill synthesized from ${cluster.length} recurring occurrences.`,
      occurrenceCount: cluster.length,
      matchedLearnings: cluster.map((l) => ({
        fileName: l.fileName,
        projectSlug: l.projectSlug,
        title: l.title,
        similarity: cosineSimilarity(cluster[0].vector, l.vector),
      })),
      draftSkillMd,
    }
  })

  // Optionally save draft candidates to disk
  if (options.outputDir && candidates.length > 0) {
    fs.mkdirSync(options.outputDir, { recursive: true })
    for (const cand of candidates) {
      const skillPath = path.join(options.outputDir, `${cand.suggestedName}.md`)
      fs.writeFileSync(skillPath, cand.draftSkillMd, 'utf-8')
    }
  }

  return {
    candidates,
    totalLearningsScanned: learnings.length,
    scanTimestamp: new Date().toISOString(),
    status: candidates.length > 0 ? 'CANDIDATES_FOUND' : 'NO_RECURRING_PATTERNS',
  }
}

// -----------------------------------------------------------------------------
// CLI Runner
// -----------------------------------------------------------------------------
if (process.argv[1]?.endsWith('skill-synthesizer.ts')) {
  const args = process.argv.slice(2)
  const cmd = args[0] || 'scan'

  console.log(`\n🔍 MemFS Skill Synthesizer & Auto-Promotion Engine\n`)
  const result = scanAndSynthesizeSkills()

  console.log(`- Total Learnings Scanned : ${result.totalLearningsScanned}`)
  console.log(`- Recurring Candidates    : ${result.candidates.length}`)
  console.log(`- Status                  : ${result.status}\n`)

  if (result.candidates.length > 0) {
    console.log(`📦 Synthesized Skill Candidates:`)
    for (const cand of result.candidates) {
      console.log(`\n  ⭐ /${cand.suggestedName} (${cand.occurrenceCount} occurrences)`)
      console.log(`     Title       : ${cand.title}`)
      console.log(`     Description : ${cand.description}`)
      console.log(`     Evidence    :`)
      for (const m of cand.matchedLearnings) {
        console.log(
          `       - [${m.projectSlug}] ${m.fileName} (sim: ${(m.similarity * 100).toFixed(1)}%)`,
        )
      }
    }
    console.log('')
  } else {
    console.log(
      `✓ No recurring patterns exceeding threshold (3 occurrences). All learnings are unique.\n`,
    )
  }
}
