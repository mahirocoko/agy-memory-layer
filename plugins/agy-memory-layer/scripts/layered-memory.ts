#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import {
  committedMemoryPathExists,
  listCommittedMemoryFiles,
  readCommittedMemoryFile,
} from './memory-repository.ts'

export type MemoryLayoutMode = 'empty' | 'legacy' | 'layered' | 'conflict'

export type MemoryDocument = {
  relativePath: string
  description: string
  body: string
  readOnly: boolean
  scope: 'global' | 'project'
  tier: 'system' | 'reference'
}

export type MemoryProjection = {
  mode: MemoryLayoutMode
  revision: string | null
  projectSlug: string
  globalSystem: MemoryDocument[]
  projectSystem: MemoryDocument[]
  external: MemoryDocument[]
  diagnostics: string[]
  legacyPaths: string[]
  layeredPaths: string[]
}

export type ParsedMemoryDocument = {
  description: string
  body: string
  readOnly: boolean
  diagnostics: string[]
}

export const LEGACY_GLOBAL_MEMORY_PATHS = ['global/human.md', 'global/persona.md'] as const

export const legacyProjectMemoryPaths = (projectSlug: string): string[] => [
  `projects/${projectSlug}/project.md`,
  `projects/${projectSlug}/rules.md`,
]

const FRONTMATTER_KEYS = new Set(['description', 'read_only'])
const EXTERNAL_INDEX_MAX_ENTRIES = 12
const EXTERNAL_INDEX_MAX_CHARS = 1_200

const stripSimpleQuotes = (value: string): string => {
  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')))
  ) {
    return value.slice(1, -1)
  }
  return value
}

export const parseMemoryDocument = (
  content: string,
  relativePath: string,
  options: { requireDescription?: boolean; legacyDescription?: string } = {},
): ParsedMemoryDocument => {
  const diagnostics: string[] = []
  if (!content.startsWith('---\n')) {
    if (options.requireDescription) {
      diagnostics.push(`${relativePath}: missing required description frontmatter.`)
    }
    return {
      description: options.legacyDescription || '',
      body: options.requireDescription ? '' : content.trim(),
      readOnly: false,
      diagnostics,
    }
  }

  const closingIndex = content.indexOf('\n---\n', 4)
  if (closingIndex < 0) {
    diagnostics.push(`${relativePath}: frontmatter is not closed.`)
    return { description: '', body: '', readOnly: false, diagnostics }
  }

  const values = new Map<string, string>()
  const frontmatter = content.slice(4, closingIndex)
  for (const line of frontmatter.split('\n')) {
    if (!line.trim()) continue
    if (/^\s/.test(line)) {
      diagnostics.push(`${relativePath}: multiline frontmatter is not supported.`)
      continue
    }
    const separator = line.indexOf(':')
    if (separator <= 0) {
      diagnostics.push(`${relativePath}: malformed frontmatter line "${line}".`)
      continue
    }
    const key = line.slice(0, separator).trim()
    const value = stripSimpleQuotes(line.slice(separator + 1).trim())
    if (!FRONTMATTER_KEYS.has(key)) {
      diagnostics.push(`${relativePath}: unknown frontmatter key "${key}".`)
      continue
    }
    if (values.has(key)) {
      diagnostics.push(`${relativePath}: duplicate frontmatter key "${key}".`)
      continue
    }
    values.set(key, value)
  }

  const description = values.get('description') || ''
  if (options.requireDescription && !description) {
    diagnostics.push(`${relativePath}: description must not be empty.`)
  }
  const readOnlyValue = values.get('read_only')
  if (readOnlyValue !== undefined && readOnlyValue !== 'true' && readOnlyValue !== 'false') {
    diagnostics.push(`${relativePath}: read_only must be true or false.`)
  }

  return {
    description,
    body: diagnostics.length > 0 ? '' : content.slice(closingIndex + 5).trim(),
    readOnly: readOnlyValue === 'true',
    diagnostics,
  }
}

const getCommittedRevision = (memoryRoot: string): string | null => {
  try {
    return execFileSync('git', ['-C', memoryRoot, 'rev-parse', '--verify', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

const committedMarkdownFiles = (memoryRoot: string, directory: string): string[] =>
  listCommittedMemoryFiles(memoryRoot, directory).filter((file) => file.endsWith('.md'))

const allLegacyActivePaths = (memoryRoot: string): string[] =>
  [
    ...listCommittedMemoryFiles(memoryRoot, 'global'),
    ...listCommittedMemoryFiles(memoryRoot, 'projects'),
  ]
    .filter(
      (relativePath) =>
        relativePath === 'global/human.md' ||
        relativePath === 'global/persona.md' ||
        /^projects\/[^/]+\/(project|rules)\.md$/.test(relativePath),
    )
    .sort()

const allLayeredSystemPaths = (memoryRoot: string): string[] =>
  [
    ...committedMarkdownFiles(memoryRoot, 'system'),
    ...committedMarkdownFiles(memoryRoot, 'projects').filter((relativePath) =>
      /^projects\/[^/]+\/system\/.+\.md$/.test(relativePath),
    ),
  ].sort()

const readLayeredDocuments = (
  memoryRoot: string,
  files: string[],
  scope: 'global' | 'project',
  tier: 'system' | 'reference',
  diagnostics: string[],
): MemoryDocument[] => {
  const documents: MemoryDocument[] = []
  for (const relativePath of [...new Set(files)].sort()) {
    const content = readCommittedMemoryFile(memoryRoot, relativePath)
    if (content === null) continue
    const parsed = parseMemoryDocument(content, relativePath, { requireDescription: true })
    diagnostics.push(...parsed.diagnostics)
    if (parsed.diagnostics.length > 0) continue
    documents.push({
      relativePath,
      description: parsed.description,
      body: parsed.body,
      readOnly: parsed.readOnly,
      scope,
      tier,
    })
  }
  return documents
}

const legacyDescription = (relativePath: string): string => {
  if (relativePath === 'global/human.md') return 'Global user profile and preferences.'
  if (relativePath === 'global/persona.md') return 'Persistent agent identity and behavior.'
  if (relativePath.endsWith('/project.md')) return 'Project architecture and domain context.'
  return 'Project-specific rules and conventions.'
}

const readLegacyDocuments = (
  memoryRoot: string,
  files: string[],
  projectSlug: string,
): { globalSystem: MemoryDocument[]; projectSystem: MemoryDocument[] } => {
  const documents = files.flatMap((relativePath): MemoryDocument[] => {
    const content = readCommittedMemoryFile(memoryRoot, relativePath)
    if (content === null) return []
    const parsed = parseMemoryDocument(content, relativePath, {
      legacyDescription: legacyDescription(relativePath),
    })
    return [
      {
        relativePath,
        description: parsed.description,
        body: parsed.body,
        readOnly: false,
        scope: relativePath.startsWith('global/') ? 'global' : 'project',
        tier: 'system',
      },
    ]
  })

  return {
    globalSystem: documents.filter((document) => document.scope === 'global'),
    projectSystem: documents.filter(
      (document) =>
        document.scope === 'project' &&
        document.relativePath.startsWith(`projects/${projectSlug}/`),
    ),
  }
}

export const inspectCommittedMemoryProjection = (
  memoryRoot: string,
  projectSlug: string,
): MemoryProjection => {
  const diagnostics: string[] = []
  const globalSystemPaths = committedMarkdownFiles(memoryRoot, 'system')
  const projectSystemPaths = committedMarkdownFiles(memoryRoot, `projects/${projectSlug}/system`)
  const globalReferencePaths = committedMarkdownFiles(memoryRoot, 'reference')
  const projectReferencePaths = committedMarkdownFiles(
    memoryRoot,
    `projects/${projectSlug}/reference`,
  )
  const layeredPaths = allLayeredSystemPaths(memoryRoot)
  const allLegacyPaths = [...LEGACY_GLOBAL_MEMORY_PATHS, ...legacyProjectMemoryPaths(projectSlug)]
  const selectedLegacyPaths = allLegacyPaths.filter((relativePath) =>
    committedMemoryPathExists(memoryRoot, relativePath),
  )
  const legacyPaths = allLegacyActivePaths(memoryRoot)

  if (layeredPaths.length > 0 && legacyPaths.length > 0) {
    diagnostics.push(
      `Layered and legacy active memory overlap for ${projectSlug}; no active body was projected.`,
    )
    return {
      mode: 'conflict',
      revision: getCommittedRevision(memoryRoot),
      projectSlug,
      globalSystem: [],
      projectSystem: [],
      external: [],
      diagnostics,
      legacyPaths,
      layeredPaths,
    }
  }

  if (layeredPaths.length > 0) {
    return {
      mode: 'layered',
      revision: getCommittedRevision(memoryRoot),
      projectSlug,
      globalSystem: readLayeredDocuments(
        memoryRoot,
        globalSystemPaths,
        'global',
        'system',
        diagnostics,
      ),
      projectSystem: readLayeredDocuments(
        memoryRoot,
        projectSystemPaths,
        'project',
        'system',
        diagnostics,
      ),
      external: [
        ...readLayeredDocuments(
          memoryRoot,
          globalReferencePaths,
          'global',
          'reference',
          diagnostics,
        ),
        ...readLayeredDocuments(
          memoryRoot,
          projectReferencePaths,
          'project',
          'reference',
          diagnostics,
        ),
      ].sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
      diagnostics,
      legacyPaths,
      layeredPaths,
    }
  }

  if (legacyPaths.length > 0) {
    const legacy = readLegacyDocuments(memoryRoot, selectedLegacyPaths, projectSlug)
    return {
      mode: 'legacy',
      revision: getCommittedRevision(memoryRoot),
      projectSlug,
      globalSystem: legacy.globalSystem,
      projectSystem: legacy.projectSystem,
      external: [],
      diagnostics,
      legacyPaths,
      layeredPaths,
    }
  }

  return {
    mode: 'empty',
    revision: getCommittedRevision(memoryRoot),
    projectSlug,
    globalSystem: [],
    projectSystem: [],
    external: [],
    diagnostics,
    legacyPaths,
    layeredPaths,
  }
}

const renderLayeredSystemSection = (document: MemoryDocument): string =>
  `### ${document.relativePath}\n_${document.description}_\n${document.body}\n\n`

export const renderCommittedMemoryProjection = (
  memoryRoot: string,
  projection: MemoryProjection,
): string => {
  if (projection.mode === 'conflict') {
    return `### ⚠️ Layered Memory Conflict\n${projection.diagnostics.join('\n')}\nResolve the committed layout through the migration or rollback workflow before relying on active memory.\n\n`
  }

  if (projection.mode === 'legacy') {
    let content = ''
    const byPath = new Map(
      [...projection.globalSystem, ...projection.projectSystem].map((document) => [
        document.relativePath,
        document,
      ]),
    )
    const human = byPath.get('global/human.md')
    if (human?.body) {
      content += `### 👤 User Profile & Preferences (global/human.md)\n${human.body}\n\n`
    }
    const persona = byPath.get('global/persona.md')
    if (persona?.body) {
      content += `### 🤖 Agent Persona (global/persona.md)\n${persona.body}\n\n`
    }
    const project = byPath.get(`projects/${projection.projectSlug}/project.md`)
    if (project?.body) {
      content += `### 📁 Project Context (${projection.projectSlug}/project.md)\n${project.body}\n\n`
    }
    const rules = byPath.get(`projects/${projection.projectSlug}/rules.md`)
    if (rules?.body) {
      content += `### 📋 Project Rules (${projection.projectSlug}/rules.md)\n${rules.body}\n\n`
    }
    return content
  }

  let content = ''
  const persona = projection.globalSystem.find(
    (document) => document.relativePath === 'system/persona.md',
  )
  if (persona) {
    content += `### 🤖 Agent Identity (${persona.relativePath})\n${persona.body}\n\n`
  }
  for (const document of projection.globalSystem.filter(
    (candidate) => candidate.relativePath !== 'system/persona.md',
  )) {
    content += renderLayeredSystemSection(document)
  }
  for (const document of projection.projectSystem) {
    content += renderLayeredSystemSection(document)
  }

  if (projection.external.length > 0) {
    const visible: MemoryDocument[] = []
    let renderedChars = 0
    for (const document of projection.external) {
      const line = `- ${document.relativePath} — ${document.description}`
      if (
        visible.length >= EXTERNAL_INDEX_MAX_ENTRIES ||
        renderedChars + line.length > EXTERNAL_INDEX_MAX_CHARS
      ) {
        break
      }
      visible.push(document)
      renderedChars += line.length
    }
    content += `### 📚 On-Demand Memory\nMemory root: ${path.resolve(memoryRoot)}\nRead a listed file only when its description matches the current task.\n${visible.map((document) => `- ${document.relativePath} — ${document.description}`).join('\n')}\n`
    const omitted = projection.external.length - visible.length
    if (omitted > 0)
      content += `- … ${omitted} additional reference file(s) omitted from the bounded index\n`
    content += '\n'
  }

  if (projection.diagnostics.length > 0) {
    content += `### ⚠️ Layered Memory Diagnostics\n${projection.diagnostics.join('\n')}\nMalformed committed files were excluded from active memory.\n\n`
  }
  return content
}
