import * as path from 'node:path'
import {
  listCommittedMemoryFiles,
  readCommittedMemoryFile,
  validateProjectSlug,
} from './memory-repository.ts'

export const WORKING_HYPOTHESIS_FILENAME = 'working-hypothesis.md'

export type WorkingHypothesisState = 'none' | 'selected' | 'conflict'

export type WorkingHypothesisSelection = {
  state: WorkingHypothesisState
  canonicalPath: string
  selectedPath?: string
  content?: string
  diagnostics: string[]
}

type FrontmatterResult = {
  values: Record<string, string>
  diagnostics: string[]
}

export const getWorkingHypothesisPath = (projectSlug: string): string => {
  const slug = validateProjectSlug(projectSlug)
  return `projects/${slug}/learnings/${WORKING_HYPOTHESIS_FILENAME}`
}

const parseFrontmatter = (content: string): FrontmatterResult => {
  const normalized = content.replace(/\r\n/g, '\n')
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  if (!match) {
    return { values: {}, diagnostics: ['Missing or malformed YAML frontmatter.'] }
  }

  const values: Record<string, string> = {}
  const diagnostics: string[] = []
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator <= 0) {
      diagnostics.push(`Malformed frontmatter line: ${line}`)
      continue
    }

    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!key || !value) {
      diagnostics.push(`Incomplete frontmatter entry: ${line}`)
      continue
    }
    if (Object.hasOwn(values, key)) {
      diagnostics.push(`Duplicate frontmatter key: ${key}`)
      continue
    }
    values[key] = value
  }

  return { values, diagnostics }
}

const containsFrontmatterActiveMarker = (content: string): boolean => {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return false
  const closingDelimiter = normalized.indexOf('\n---', 4)
  const frontmatterCandidate = normalized.slice(
    4,
    closingDelimiter >= 0 ? closingDelimiter : Math.min(normalized.length, 2048),
  )
  return /^memory_status:\s*active\s*$/m.test(frontmatterCandidate)
}

export const inspectCommittedWorkingHypothesis = (
  projectSlug: string,
  memoryRoot: string,
): WorkingHypothesisSelection => {
  const canonicalPath = getWorkingHypothesisPath(projectSlug)
  const learningsDirectory = path.posix.dirname(canonicalPath)
  const files = listCommittedMemoryFiles(memoryRoot, learningsDirectory).filter((file) =>
    file.endsWith('.md'),
  )
  const diagnostics: string[] = []
  let canonicalContent: string | undefined

  for (const file of files) {
    const content = readCommittedMemoryFile(memoryRoot, file)
    if (content === null) continue
    const parsed = parseFrontmatter(content)
    const isCanonical = file === canonicalPath
    const isActive = parsed.values.memory_status === 'active'
    const isWorkingHypothesis = parsed.values.memory_kind === 'working-hypothesis'

    if (isCanonical) {
      for (const diagnostic of parsed.diagnostics) {
        diagnostics.push(`${file}: ${diagnostic}`)
      }
      if (!isActive) {
        diagnostics.push(`${file}: canonical hypothesis must declare memory_status: active.`)
      }
      if (!isWorkingHypothesis) {
        diagnostics.push(
          `${file}: canonical hypothesis must declare memory_kind: working-hypothesis.`,
        )
      }
      if (parsed.diagnostics.length === 0 && isActive && isWorkingHypothesis) {
        canonicalContent = content
      }
      continue
    }

    if (isActive || containsFrontmatterActiveMarker(content)) {
      diagnostics.push(`${file}: active learning exists outside the canonical hypothesis path.`)
    }
  }

  if (diagnostics.length > 0) {
    return { state: 'conflict', canonicalPath, diagnostics }
  }
  if (!canonicalContent) {
    return { state: 'none', canonicalPath, diagnostics: [] }
  }
  return {
    state: 'selected',
    canonicalPath,
    selectedPath: canonicalPath,
    content: canonicalContent,
    diagnostics: [],
  }
}

export const extractWorkingHypothesisBullets = (
  content: string,
  maxBullets: number = 4,
): string[] =>
  content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, Math.max(0, maxBullets))
