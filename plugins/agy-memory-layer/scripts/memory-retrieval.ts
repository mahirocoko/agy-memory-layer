#!/usr/bin/env node

/**
 * Tiered v2 Memory Retrieval, Directory Paging, Topic Discovery & Palace Structure.
 * Ported from mahiro-pi/lib/agent-memory/retrieval.ts for agy-memory-layer.
 * Strict TypeScript `type` aliases only; zero external dependencies.
 */

import { execFileSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  getMemoryHeadRevision,
  listCommittedMemoryFiles,
  normalizeMemoryRelativePath,
  readCommittedMemoryFile,
} from './memory-repository.ts'
import {
  allowedMemoryDirectory,
  allowedMemoryPath,
  isAlwaysLoadedTieredPath,
  isCriticalLinkSource,
  isProtectedRetentionPath,
  MEMORY_LIMITS,
  MemorySchemaError,
  utf8Bytes,
} from './memory-schema.ts'

export const DISCOVERY_VERSION = 2

export const RETRIEVAL_LIMITS = Object.freeze({
  queryBytes: 256,
  terms: 16,
  results: 8,
  page: 32,
  indexPreview: 4096,
  snippetCharacters: 192,
  outputBytes: 32768,
  workBytes: 1024 * 1024,
})

export const PALACE_REPLY_BYTES = 240 * 1024

export type ReadSelection =
  | { mode: 'list' }
  | { mode: 'path'; path: string; offset: number; limit: number }
  | { mode: 'query'; query: string; offset: number; limit: number }
  | { mode: 'topic'; topic: string; offset: number; limit: number }

export type MemoryReadArgs = {
  path?: string
  query?: string
  topic?: string
  offset?: number
  limit?: number
}

export type ExtractedFrontmatterAndLinks = {
  name?: string
  description?: string
  readOnly?: boolean
  links: string[]
}

export type DirectoryIndexPointer = {
  path: string
  index: string
}

export type PalaceLayer =
  | 'core'
  | 'index'
  | 'system'
  | 'reference'
  | 'projectSystem'
  | 'projectReference'
  | 'archives'
  | 'legacy'

export type PalaceFileEntry = {
  path: string
  layer: PalaceLayer
  bytes: number
  protectedRetention: boolean
  alwaysLoaded: boolean
  name?: string
  description?: string
  links?: string[]
}

export type PalaceReport = {
  revision: string | null
  project: string
  healthy: boolean
  coverage: {
    complete: boolean
    inspectedFiles: number
    nonArchiveFiles: number
    totalFiles: number
    filesReturned: number
    filesTruncated: boolean
    layersTruncated: boolean
    brokenLinksTotal: number
    criticalBrokenLinksTotal: number
    advisoryBrokenLinksTotal: number
    brokenLinksTruncated: boolean
  }
  budget: {
    coreBytes: number
    indexBytes: number
    fileBytes: number
    totalBytesUsed: number
    totalBytesCeiling: number
    alwaysLoadedBytes: number
    fileCount: number
    fileCeiling: number
  }
  layers: Record<PalaceLayer, string[]>
  files: PalaceFileEntry[]
  brokenLinks: Array<{ source: string; target: string }>
}

const NAMESPACE_PATTERN =
  '^(?:\\*|global|procedures|system(?:/human(?:/prefs)?)?|reference(?:/[a-z0-9][a-z0-9-]{0,63})?|deferred/[a-z0-9][a-z0-9-]{0,99}|projects/[a-z0-9][a-z0-9-]{0,99}(?:/(?:system|reference(?:/[a-z0-9][a-z0-9-]{0,63})?))?)?$'

const fold = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/ς/g, 'σ')

const QUERY_STOPWORDS = new Set([
  'อะไร',
  'ไหม',
  'มั้ย',
  'หรือ',
  'เปล่า',
  'ใคร',
  'ไหน',
  'ที่ไหน',
  'เมื่อไหร่',
  'ทำไม',
  'อย่างไร',
  'ยังไง',
  'ของ',
  'ฉัน',
  'ผม',
  'เรา',
  'คุณ',
  'คือ',
  'มี',
  'เป็น',
  'ใน',
  'ที่',
  'และ',
  'กับ',
  'ให้',
  'ได้',
  'นะ',
  'ครับ',
  'ค่ะ',
  'what',
  'who',
  'where',
  'when',
  'why',
  'how',
  'is',
  'are',
  'was',
  'were',
  'do',
  'does',
  'did',
  'my',
  'your',
  'our',
  'the',
  'a',
  'an',
  'of',
  'in',
  'on',
  'for',
  'to',
  'with',
  'and',
])

const sha256Hex = (value: string): string => crypto.createHash('sha256').update(value).digest('hex')

const segmentTerms = (value: string): string[] => [
  ...new Set(
    [...new Intl.Segmenter('th', { granularity: 'word' }).segment(fold(value))]
      .filter((part) => part.isWordLike)
      .map((part) => part.segment),
  ),
]

function containsControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function assertValidQueryTerms(query: string): string[] {
  if (
    !query.trim() ||
    utf8Bytes(query) > RETRIEVAL_LIMITS.queryBytes ||
    containsControlChars(query)
  ) {
    throw new MemorySchemaError('INVALID_ARGUMENTS', 'Invalid bounded memory query.')
  }
  const terms = segmentTerms(query)
  if (!terms.length || terms.length > RETRIEVAL_LIMITS.terms) {
    throw new MemorySchemaError('INVALID_ARGUMENTS', 'Invalid memory query terms.')
  }
  return terms
}

export function tokenizeQueryClauses(query: string): string[][] {
  const allTerms = assertValidQueryTerms(query)
  const rawClauses = query
    .split(/\s*(?:\||\bOR\b)\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  const clauses = (rawClauses.length > 1 ? rawClauses.map(segmentTerms) : [allTerms])
    .filter((clause) => clause.length > 0)
    .map((clause) => {
      const content = clause.filter((term) => !QUERY_STOPWORDS.has(term))
      return content.length > 0 ? content : clause
    })
  return clauses.length > 0 ? clauses : [allTerms]
}

export function matchesQueryClauses(
  clauses: readonly (readonly string[])[],
  pathText: string,
  text: string,
): string[] | null {
  for (const clause of clauses) {
    const matched = clause.filter((term) => pathText.includes(term) || text.includes(term))
    const required =
      clause.length <= 2 ? clause.length : Math.max(2, Math.ceil(clause.length * 0.5))
    if (matched.length >= required) return matched
  }
  return null
}

export function extractFrontmatterAndLinks(
  text: string,
  linkTargetCharacters: number = 128,
): ExtractedFrontmatterAndLinks {
  const normalizedText = text.replace(/\r\n?/g, '\n')
  let name: string | undefined
  let description: string | undefined
  let readOnly: boolean | undefined
  const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalizedText)
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = /^([a-zA-Z0-9_-]+):\s*(.+?)\s*$/.exec(line)
      if (!m) continue
      const val = m[2].replace(/^['"]|['"]$/g, '').trim()
      if (m[1] === 'name' && val) name = val
      if (m[1] === 'description' && val) description = val
      if (m[1] === 'read_only' && (val === 'true' || val === 'false')) readOnly = val === 'true'
    }
  }
  const links = [
    ...new Set(
      [...normalizedText.matchAll(/\[\[([^\][\n]+)\]\]/g)]
        .filter((m) => m[1].length <= linkTargetCharacters)
        .map((m) => m[1].trim())
        .filter((link) => link.length > 0),
    ),
  ]
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(readOnly !== undefined ? { readOnly } : {}),
    links,
  }
}

export function projectedDirectoryIndexes(
  paths: readonly string[],
  projectSlug?: string,
): { directories: DirectoryIndexPointer[]; directoriesTruncated?: true } {
  const activeSet = new Set(paths)
  const indexes = [...activeSet]
    .filter((candidate) => {
      if (
        candidate === 'index.md' ||
        !candidate.endsWith('/index.md') ||
        candidate.startsWith('archives/')
      ) {
        return false
      }
      if (!allowedMemoryPath(candidate, projectSlug)) return false
      const parts = candidate.slice(0, -'/index.md'.length).split('/')
      for (let i = 1; i < parts.length; i++) {
        const ancestor = `${parts.slice(0, i).join('/')}/index.md`
        if (allowedMemoryPath(ancestor, projectSlug) && !activeSet.has(ancestor)) return false
      }
      return true
    })
    .sort()
  return {
    directories: indexes.slice(0, RETRIEVAL_LIMITS.page).map((index) => ({
      path: `${index.slice(0, -'/index.md'.length)}/`,
      index,
    })),
    ...(indexes.length > RETRIEVAL_LIMITS.page ? { directoriesTruncated: true as const } : {}),
  }
}

export function childIndexDescription(text: string): string | undefined {
  const fromFrontmatter = extractFrontmatterAndLinks(text).description
  if (fromFrontmatter) return fromFrontmatter
  const body = text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '')
  for (const block of body.split(/\n\s*\n/)) {
    const paragraph = block.trim()
    if (!paragraph || /^(#|[-*+] |\d+\. |\||```|<)/.test(paragraph)) continue
    const prose = paragraph.replace(/\s*\n\s*/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    return prose.length > 300 ? `${prose.slice(0, 297)}...` : prose
  }
  return undefined
}

const MEMORY_SUGGESTION_LIMIT = 5

function blockedMemoryLookup(candidate: string): boolean {
  if (
    candidate.length === 0 ||
    candidate.length > 512 ||
    candidate.startsWith('/') ||
    /^[A-Za-z]:/.test(candidate) ||
    candidate.includes('\\') ||
    containsControlChars(candidate)
  ) {
    return true
  }
  return candidate
    .split('/')
    .some(
      (segment) => segment === '' || segment === '.' || segment === '..' || segment.startsWith('.'),
    )
}

export function memoryExtensionSuggestion(
  requested: string,
  authorizedPaths: readonly string[],
): string[] {
  if (blockedMemoryLookup(requested) || requested.endsWith('.md')) return []
  const sibling = `${requested}.md`
  return authorizedPaths.includes(sibling) ? [sibling] : []
}

export function memoryPathSuggestions(
  requested: string,
  authorizedPaths: readonly string[],
): string[] {
  const extension = memoryExtensionSuggestion(requested, authorizedPaths)
  if (extension.length > 0) return extension
  if (blockedMemoryLookup(requested)) return []
  const name = requested.slice(requested.lastIndexOf('/') + 1)
  const found: string[] = []
  for (const candidate of authorizedPaths) {
    if (found.length >= MEMORY_SUGGESTION_LIMIT) break
    if (!candidate.includes('/') || candidate === requested) continue
    if (candidate.split('/').some((segment) => segment.startsWith('.'))) continue
    if (candidate.slice(candidate.lastIndexOf('/') + 1) === name) found.push(candidate)
  }
  return found
}

export function memoryMissingHint(requested: string, suggestions: readonly string[]): string {
  return `No memory at ${requested}. Did you mean ${suggestions.join(' or ')}? Paths are relative to the memory directory.`
}

export function childDirectoryPaths(
  paths: readonly string[],
  directory: string,
  edited?: ReadonlyMap<string, number>,
): string[] {
  const prefix = `${directory}/`
  const found = new Set<string>()
  for (const candidate of paths) {
    if (!candidate.startsWith(prefix)) continue
    const rest = candidate.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash <= 0) continue
    const name = rest.slice(0, slash)
    if (!name || name.startsWith('.')) continue
    found.add(`${directory}/${name}`)
  }
  const children = [...found]
  if (edited) {
    children.sort(
      (a, b) =>
        (edited.get(b.slice(prefix.length)) ?? 0) - (edited.get(a.slice(prefix.length)) ?? 0) ||
        a.localeCompare(b),
    )
  } else {
    children.sort()
  }
  return children
}

export function directoryPage(
  paths: readonly string[],
  prefix: string,
  offset: number,
  limit: number,
  edited?: ReadonlyMap<string, number>,
): {
  directory: string
  paths: string[]
  total: number
  offset: number
  limit: number
  truncated: boolean
  nextOffset?: number
} {
  const directory = prefix.replace(/\/+$/, '')
  const child = (candidate: string) => candidate.slice(directory.length + 1).split('/')[0] ?? ''
  const all = [...new Set(paths.filter((candidate) => candidate.startsWith(`${directory}/`)))]
  if (edited) {
    all.sort(
      (a, b) =>
        (edited.get(child(b)) ?? 0) - (edited.get(child(a)) ?? 0) ||
        child(a).localeCompare(child(b)) ||
        a.localeCompare(b),
    )
  } else {
    all.sort()
  }
  const boundedLimit = Math.min(limit, RETRIEVAL_LIMITS.page)
  const pagePaths = all.slice(offset, offset + boundedLimit)
  const nextOffset = offset + pagePaths.length
  return {
    directory,
    paths: pagePaths,
    total: all.length,
    offset,
    limit: boundedLimit,
    truncated: offset > 0 || nextOffset < all.length,
    ...(nextOffset < all.length ? { nextOffset } : {}),
  }
}

export function getDirectoryChildCommitTimes(
  memoryRoot: string,
  directory: string,
  activePaths: readonly string[],
): Map<string, number> {
  const result = new Map<string, number>()
  if (!fs.existsSync(path.join(memoryRoot, '.git'))) return result
  const cleanDir = directory.replace(/\/+$/, '')
  const prefix = `${cleanDir}/`
  const children = new Set<string>()
  for (const candidate of activePaths) {
    if (!candidate.startsWith(prefix)) continue
    const child = candidate.slice(prefix.length).split('/')[0]
    if (child) children.add(child)
  }
  for (const child of children) {
    try {
      const out = execFileSync(
        'git',
        ['-C', memoryRoot, 'log', '-1', '--format=%ct', '--', `${prefix}${child}`],
        {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 5000,
        },
      ).trim()
      const seconds = Number.parseInt(out, 10)
      if (Number.isFinite(seconds) && seconds > 0) {
        result.set(child, seconds)
      }
    } catch {
      // Ignore git log failures for unknown/draft-only children
    }
  }
  return result
}

export const topicFor = (relativePath: string): string =>
  relativePath.startsWith('deferred/')
    ? relativePath.split('/').slice(0, 2).join('/')
    : relativePath.startsWith('projects/')
      ? relativePath.split('/').slice(0, 3).join('/')
      : relativePath.startsWith('system/human/')
        ? 'system/human'
        : relativePath.includes('/')
          ? (relativePath.split('/')[0] ?? 'core')
          : 'core'

export function topicMetadata(paths: readonly string[]): Array<{ topic: string; files: number }> {
  const counts = new Map<string, number>()
  for (const candidate of paths) {
    const topic = topicFor(candidate)
    if (topic !== 'core' && topic !== 'archives') {
      counts.set(topic, (counts.get(topic) ?? 0) + 1)
    }
  }
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([topic, files]) => ({ topic, files }))
}

function searchable(text: string): { folded: string; starts: number[] } {
  let folded = ''
  const starts: number[] = []
  let point = 0
  for (const part of new Intl.Segmenter('th', {
    granularity: 'grapheme',
  }).segment(text)) {
    const normalized = fold(part.segment)
    folded += normalized
    for (let i = 0; i < normalized.length; i++) starts.push(point)
    point += [...part.segment].length
  }
  return { folded, starts }
}

export function parseMemoryReadArgs(args: unknown): ReadSelection {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new MemorySchemaError('INVALID_ARGUMENTS', 'Invalid memory read arguments.')
  }
  const candidate = args as Record<string, unknown>
  const allowedKeys = new Set(['path', 'query', 'topic', 'offset', 'limit'])
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      throw new MemorySchemaError('INVALID_ARGUMENTS', `Unknown memory read argument: ${key}`)
    }
  }
  const rawSelectors = (['path', 'query', 'topic'] as const).filter(
    (key) => Object.hasOwn(candidate, key) && candidate[key] !== undefined,
  )
  const nonEmptySelectors = rawSelectors.filter(
    (key) => typeof candidate[key] === 'string' && (candidate[key] as string).length > 0,
  )
  const selectors = nonEmptySelectors.length > 0 ? nonEmptySelectors : rawSelectors
  if (selectors.length === 0) {
    if (
      Object.keys(candidate).some((key) => candidate[key] !== undefined && candidate[key] !== '')
    ) {
      throw new MemorySchemaError('INVALID_ARGUMENTS', 'Selector required for paging.')
    }
    return { mode: 'list' }
  }
  if (selectors.length !== 1) {
    throw new MemorySchemaError('INVALID_ARGUMENTS', 'Memory read modes are mutually exclusive.')
  }
  const mode = selectors[0]
  const rawValue = candidate[mode]
  const offset = candidate.offset === undefined ? 0 : candidate.offset
  const maximum = mode === 'path' ? 4096 : mode === 'query' ? 8 : 32
  const limit = candidate.limit === undefined ? maximum : candidate.limit
  if (
    typeof rawValue !== 'string' ||
    !Number.isSafeInteger(offset) ||
    (offset as number) < 0 ||
    !Number.isSafeInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > 4096
  ) {
    throw new MemorySchemaError('INVALID_ARGUMENTS', 'Invalid memory read paging.')
  }
  const stripped =
    mode === 'path' && rawValue.startsWith('/') ? rawValue.replace(/^\/+/, '') : rawValue
  const value =
    mode === 'path' &&
    rawValue.startsWith('/') &&
    (allowedMemoryPath(stripped) ||
      allowedMemoryDirectory(stripped.replace(/\/+$/, ''), undefined, true))
      ? stripped
      : rawValue
  const clampedLimit = Math.min(limit as number, maximum)
  if (mode === 'query') assertValidQueryTerms(value)
  if (mode === 'topic' && !new RegExp(NAMESPACE_PATTERN).test(value)) {
    throw new MemorySchemaError('INVALID_ARGUMENTS', `Invalid memory topic: ${value}`)
  }
  return { mode, [mode]: value, offset, limit: clampedLimit } as ReadSelection
}

export type MemoryCorpusFile = {
  path: string
  text: string
  basis: 'committed' | 'draft'
}

export function loadAuthorizedMemoryCorpus(
  memoryRoot: string,
  options: {
    projectSlug?: string
    projectedOverrides?: Record<string, string>
    draftOverlay?: Record<string, string | null>
    includeArchives?: boolean
  } = {},
): { revision: string | null; files: Record<string, MemoryCorpusFile> } {
  const revision = getMemoryHeadRevision(memoryRoot)
  const files: Record<string, MemoryCorpusFile> = {}
  const committedPaths = revision ? listCommittedMemoryFiles(memoryRoot, '') : []
  for (const relativePath of committedPaths) {
    if (!relativePath.endsWith('.md')) continue
    if (!options.includeArchives && relativePath.startsWith('archives/')) continue
    if (!allowedMemoryPath(relativePath, options.projectSlug)) continue
    const text = readCommittedMemoryFile(memoryRoot, relativePath)
    if (text !== null) {
      files[relativePath] = { path: relativePath, text, basis: 'committed' }
    }
  }
  if (options.projectedOverrides) {
    for (const [rawPath, overrideText] of Object.entries(options.projectedOverrides)) {
      const relativePath = normalizeMemoryRelativePath(rawPath)
      if (!allowedMemoryPath(relativePath, options.projectSlug)) continue
      files[relativePath] = { path: relativePath, text: overrideText, basis: 'committed' }
    }
  }
  if (options.draftOverlay) {
    for (const [rawPath, draftText] of Object.entries(options.draftOverlay)) {
      const relativePath = normalizeMemoryRelativePath(rawPath)
      if (!allowedMemoryPath(relativePath, options.projectSlug)) continue
      if (draftText === null) {
        delete files[relativePath]
      } else {
        files[relativePath] = { path: relativePath, text: draftText, basis: 'draft' }
      }
    }
  }
  return { revision, files }
}

export function readMemory(
  memoryRoot: string,
  args: MemoryReadArgs,
  options: {
    projectSlug?: string
    projectedOverrides?: Record<string, string>
    draftOverlay?: Record<string, string | null>
    includeArchives?: boolean
  } = {},
): Record<string, unknown> {
  const selection = parseMemoryReadArgs(args)
  const { revision, files } = loadAuthorizedMemoryCorpus(memoryRoot, options)
  const paths = Object.keys(files).sort()

  if (selection.mode === 'list') {
    return {
      discoveryVersion: DISCOVERY_VERSION,
      currentRevision: revision,
      basis:
        options.draftOverlay && Object.keys(options.draftOverlay).length > 0
          ? 'draft'
          : 'committed',
      files: paths.map((candidate) => {
        const entry = files[candidate]
        const meta = extractFrontmatterAndLinks(entry?.text ?? '')
        return {
          path: candidate,
          basis: entry?.basis ?? 'committed',
          ...(meta.name ? { name: meta.name } : {}),
          ...(meta.description ? { description: meta.description } : {}),
        }
      }),
    }
  }

  if (selection.mode === 'topic') {
    const { offset, limit } = selection
    const entries =
      selection.topic === ''
        ? topicMetadata(paths)
        : paths
            .filter(
              (candidate) =>
                selection.topic === '*' ||
                topicFor(candidate) === selection.topic ||
                candidate.startsWith(`${selection.topic}/`),
            )
            .map((candidate) => {
              const entry = files[candidate]
              const meta = extractFrontmatterAndLinks(entry?.text ?? '')
              return {
                path: candidate,
                ...(meta.name ? { name: meta.name } : {}),
                ...(meta.description ? { description: meta.description } : {}),
                ...(meta.links.length ? { links: meta.links } : {}),
              }
            })
    return {
      discoveryVersion: DISCOVERY_VERSION,
      currentRevision: revision,
      topic: selection.topic,
      entries: entries.slice(offset, offset + limit),
      offset,
      total: entries.length,
      complete: offset + limit >= entries.length,
      ...(offset + limit < entries.length ? { nextOffset: offset + limit } : {}),
    }
  }

  if (selection.mode === 'query') {
    const { offset, limit } = selection
    const clauses = tokenizeQueryClauses(selection.query)
    const results: Array<{
      path: string
      hash: string
      citation: string
      basis: 'committed' | 'draft'
      text: string
      offset: number
      totalCharacters: number
      truncated: boolean
    }> = []
    let workBytes = 0
    let cursor = Math.min(offset, paths.length)
    for (; cursor < paths.length; cursor++) {
      const candidate = paths[cursor]
      if (!candidate) continue
      const file = files[candidate]
      if (!file) continue
      const cost = utf8Bytes(file.text)
      if (workBytes + cost > RETRIEVAL_LIMITS.workBytes || results.length >= limit) break
      workBytes += cost
      const pathText = fold(candidate)
      const textFolded = fold(file.text)
      const matchedTerms = matchesQueryClauses(clauses, pathText, textFolded)
      if (!matchedTerms) continue
      const mapped = searchable(file.text)
      const positions = matchedTerms
        .map((term) => mapped.folded.indexOf(term))
        .filter((at) => at >= 0)
      const start = positions.length
        ? Math.max(0, (mapped.starts[Math.min(...positions)] ?? 0) - 48)
        : 0
      const characters = [...file.text]
      const hash = sha256Hex(file.text)
      const result = {
        path: candidate,
        hash,
        citation: `${candidate}#sha256:${hash}`,
        basis: file.basis,
        text: characters.slice(start, start + RETRIEVAL_LIMITS.snippetCharacters).join(''),
        offset: start,
        totalCharacters: characters.length,
        truncated: start > 0 || start + RETRIEVAL_LIMITS.snippetCharacters < characters.length,
      }
      if (utf8Bytes(JSON.stringify([...results, result])) > RETRIEVAL_LIMITS.outputBytes - 2048)
        break
      results.push(result)
    }
    const complete = cursor >= paths.length
    return {
      query: selection.query,
      currentRevision: revision,
      results,
      offset,
      complete,
      outcome: complete ? (results.length > 0 ? 'matches' : 'no-match') : 'incomplete',
      workBytes,
      ...(complete ? {} : { nextOffset: cursor }),
    }
  }

  // selection.mode === 'path'
  const cleanDir = selection.path.replace(/\/+$/, '')
  const isKnownDir =
    cleanDir.length > 0 &&
    !cleanDir.endsWith('.md') &&
    allowedMemoryDirectory(cleanDir, options.projectSlug, true) &&
    paths.some((candidate) => candidate.startsWith(`${cleanDir}/`))

  if (isKnownDir) {
    const edited = getDirectoryChildCommitTimes(memoryRoot, cleanDir, paths)
    const page = directoryPage(paths, cleanDir, selection.offset, selection.limit, edited)
    const entries = page.paths.map((candidate) => {
      const entry = files[candidate]
      const meta = extractFrontmatterAndLinks(entry?.text ?? '')
      return {
        path: candidate,
        basis: entry?.basis ?? 'committed',
        ...(meta.name ? { name: meta.name } : {}),
        ...(meta.description ? { description: meta.description } : {}),
        ...(meta.links.length ? { links: meta.links } : {}),
      }
    })
    const childDirectories = childDirectoryPaths(paths, cleanDir, edited)
      .slice(0, RETRIEVAL_LIMITS.page)
      .map((dirPath) => {
        const indexPath = `${dirPath}/index.md`
        const indexFile = files[indexPath]
        const description = indexFile ? childIndexDescription(indexFile.text) : undefined
        return {
          path: `${dirPath}/`,
          index: indexPath,
          ...(description ? { description } : {}),
        }
      })
    const ownIndexPath = `${cleanDir}/index.md`
    const ownIndexFile = files[ownIndexPath]
    const indexPreview = ownIndexFile
      ? (() => {
          const chars = [...ownIndexFile.text]
          const previewText = chars.slice(0, RETRIEVAL_LIMITS.indexPreview).join('')
          return {
            path: ownIndexPath,
            hash: sha256Hex(ownIndexFile.text),
            text: previewText,
            offset: 0,
            totalCharacters: chars.length,
            truncated: chars.length > RETRIEVAL_LIMITS.indexPreview,
          }
        })()
      : undefined
    return {
      directory: page.directory,
      currentRevision: revision,
      basis:
        options.draftOverlay && Object.keys(options.draftOverlay).length > 0
          ? 'draft'
          : 'committed',
      entries,
      childDirectories,
      ...(indexPreview ? { indexPreview } : {}),
      total: page.total,
      offset: page.offset,
      limit: page.limit,
      truncated: page.truncated,
      ...(page.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {}),
    }
  }

  let normalizedPath: string
  try {
    normalizedPath = normalizeMemoryRelativePath(selection.path)
  } catch {
    throw new MemorySchemaError('INVALID_PATH', `Invalid memory path: ${selection.path}`)
  }
  if (!allowedMemoryPath(normalizedPath, options.projectSlug)) {
    throw new MemorySchemaError(
      'INVALID_PATH',
      `Unauthorized or unsupported memory path: ${normalizedPath}`,
    )
  }

  const file = files[normalizedPath]
  if (!file) {
    const suggestions = memoryPathSuggestions(normalizedPath, paths)
    return {
      missing: true,
      path: normalizedPath,
      hash: null,
      currentRevision: revision,
      suggestions,
      ...(suggestions.length > 0 ? { hint: memoryMissingHint(normalizedPath, suggestions) } : {}),
    }
  }

  const characters = [...file.text]
  const start = Math.min(selection.offset, characters.length)
  const slice = characters.slice(start, start + selection.limit).join('')
  const nextOffset = start + [...slice].length
  const hash = sha256Hex(file.text)
  const meta = extractFrontmatterAndLinks(file.text)
  return {
    path: normalizedPath,
    hash,
    citation: `${normalizedPath}#sha256:${hash}`,
    basis: file.basis,
    currentRevision: revision,
    text: slice,
    offset: start,
    limit: selection.limit,
    totalCharacters: characters.length,
    truncated: start > 0 || nextOffset < characters.length,
    ...(nextOffset < characters.length ? { nextOffset } : {}),
    ...(meta.name ? { name: meta.name } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.readOnly !== undefined ? { readOnly: meta.readOnly } : {}),
    ...(meta.links.length ? { links: meta.links } : {}),
  }
}

export function palaceLayerFor(relativePath: string): PalaceLayer {
  if (relativePath === 'Core.md') return 'core'
  if (relativePath === 'index.md') return 'index'
  if (relativePath === 'system/persona.md' || relativePath.startsWith('system/')) return 'system'
  if (relativePath.startsWith('reference/') || relativePath.startsWith('procedures/'))
    return 'reference'
  if (/^projects\/[a-z0-9][a-z0-9-]{0,99}\/system\//.test(relativePath)) return 'projectSystem'
  if (/^projects\/[a-z0-9][a-z0-9-]{0,99}\/(?:reference|learnings)\//.test(relativePath))
    return 'projectReference'
  if (relativePath.startsWith('archives/')) return 'archives'
  return 'legacy'
}

export function buildMemoryPalaceReport(input: {
  revision: string | null
  projectSlug: string
  files: Record<string, string | undefined>
}): PalaceReport {
  const sortedPaths = Object.keys(input.files)
    .filter((candidate) => candidate.endsWith('.md') && typeof input.files[candidate] === 'string')
    .sort()
  const nonArchivePaths = sortedPaths.filter((candidate) => !candidate.startsWith('archives/'))
  const archivePaths = sortedPaths.filter((candidate) => candidate.startsWith('archives/'))
  const orderedPaths = [...nonArchivePaths, ...archivePaths]
  const activeSet = new Set(sortedPaths)
  const layers: Record<PalaceLayer, string[]> = {
    core: [],
    index: [],
    system: [],
    reference: [],
    projectSystem: [],
    projectReference: [],
    archives: [],
    legacy: [],
  }

  let totalBytesUsed = 0
  let alwaysLoadedBytes = 0
  let inspectedFiles = 0
  let uninspectedNonArchive = 0
  let brokenLinksTotal = 0
  let criticalBrokenLinksTotal = 0
  let advisoryBrokenLinksTotal = 0
  let filesBytesUsed = 0
  let filesCapped = false
  const entries: PalaceFileEntry[] = []
  const brokenLinks: Array<{ source: string; target: string }> = []

  for (const relativePath of orderedPaths) {
    const text = input.files[relativePath]
    const size = typeof text === 'string' ? utf8Bytes(text) : 0
    const layer = palaceLayerFor(relativePath)
    totalBytesUsed += size
    const alwaysLoaded = isAlwaysLoadedTieredPath(relativePath, input.projectSlug)
    if (alwaysLoaded) alwaysLoadedBytes += size
    const isArchive = relativePath.startsWith('archives/')
    if (!isArchive) {
      if (typeof text === 'string') inspectedFiles++
      else uninspectedNonArchive++
    }
    const meta =
      !isArchive && typeof text === 'string'
        ? extractFrontmatterAndLinks(text, MEMORY_LIMITS.fileBytes)
        : { links: [] }
    const dir = relativePath.includes('/')
      ? relativePath.slice(0, relativePath.lastIndexOf('/') + 1)
      : ''
    for (const link of meta.links) {
      const normalized = link.endsWith('.md') ? link : `${link}.md`
      if (
        !activeSet.has(link) &&
        !activeSet.has(normalized) &&
        !(
          dir &&
          !link.includes('/') &&
          (activeSet.has(`${dir}${link}`) || activeSet.has(`${dir}${normalized}`))
        )
      ) {
        brokenLinksTotal++
        if (isCriticalLinkSource(relativePath, input.projectSlug)) criticalBrokenLinksTotal++
        else advisoryBrokenLinksTotal++
        if (brokenLinks.length < 64) {
          brokenLinks.push({ source: relativePath, target: link.slice(0, 128) })
        }
      }
    }
    if (!filesCapped && entries.length < MEMORY_LIMITS.files) {
      const entry: PalaceFileEntry = {
        path: relativePath,
        layer,
        bytes: size,
        protectedRetention: isProtectedRetentionPath(relativePath),
        alwaysLoaded,
        ...(meta.name ? { name: meta.name.slice(0, 128) } : {}),
        ...(meta.description ? { description: meta.description.slice(0, 256) } : {}),
        ...(meta.links.length
          ? { links: meta.links.slice(0, 16).map((l) => l.slice(0, 128)) }
          : {}),
      }
      const entryBytes = utf8Bytes(JSON.stringify(entry))
      if (filesBytesUsed + entryBytes <= 163_840) {
        entries.push(entry)
        layers[layer].push(relativePath)
        filesBytesUsed += entryBytes
      } else {
        filesCapped = true
      }
    }
  }

  const complete = uninspectedNonArchive === 0
  const palace: PalaceReport = {
    revision: input.revision,
    project: input.projectSlug,
    healthy:
      complete && totalBytesUsed <= MEMORY_LIMITS.totalBytes && criticalBrokenLinksTotal === 0,
    coverage: {
      complete,
      inspectedFiles,
      nonArchiveFiles: nonArchivePaths.length,
      totalFiles: sortedPaths.length,
      filesReturned: entries.length,
      filesTruncated: entries.length < sortedPaths.length,
      layersTruncated: entries.length < sortedPaths.length,
      brokenLinksTotal,
      criticalBrokenLinksTotal,
      advisoryBrokenLinksTotal,
      brokenLinksTruncated: brokenLinks.length < brokenLinksTotal,
    },
    budget: {
      coreBytes: MEMORY_LIMITS.coreBytes,
      indexBytes: MEMORY_LIMITS.indexBytes,
      fileBytes: MEMORY_LIMITS.fileBytes,
      totalBytesUsed,
      totalBytesCeiling: MEMORY_LIMITS.totalBytes,
      alwaysLoadedBytes,
      fileCount: sortedPaths.length,
      fileCeiling: MEMORY_LIMITS.files,
    },
    layers,
    files: entries,
    brokenLinks,
  }

  while (utf8Bytes(JSON.stringify({ palace })) > PALACE_REPLY_BYTES) {
    const removed = entries.pop()
    if (removed) layers[removed.layer].pop()
    else if (brokenLinks.length) brokenLinks.pop()
    else break
    palace.coverage.filesReturned = entries.length
    palace.coverage.filesTruncated = entries.length < sortedPaths.length
    palace.coverage.layersTruncated = palace.coverage.filesTruncated
    palace.coverage.brokenLinksTruncated = brokenLinks.length < brokenLinksTotal
  }

  return palace
}
